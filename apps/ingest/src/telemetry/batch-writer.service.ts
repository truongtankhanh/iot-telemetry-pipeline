import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { Database } from '../database/database';
import { Metrics } from '../metrics/metrics';
import { RulesService } from '../rules/rules.service';
import { type Reading, rollup } from './rollup';

/**
 * Buffers readings and writes them in batches (ADR-0002, ADR-0003). One flush is one transaction:
 * insert with ON CONFLICT DO NOTHING, then roll up only the rows that were actually inserted —
 * so a redelivered message can never inflate a count.
 */
@Injectable()
export class BatchWriter implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BatchWriter.name);
  private buffer: Reading[] = [];
  private timer?: NodeJS.Timeout;
  private flushing: Promise<void> = Promise.resolve();
  private readonly maxReadings: number;
  private readonly intervalMs: number;

  constructor(
    private readonly db: Database,
    private readonly metrics: Metrics,
    private readonly rules: RulesService,
    config: ConfigService<Env, true>,
  ) {
    this.maxReadings = config.get('FLUSH_MAX_READINGS', { infer: true });
    this.intervalMs = config.get('FLUSH_INTERVAL_MS', { infer: true });
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
  }

  /** Nest calls this after the MQTT consumer has stopped — the buffer is drained before exit. */
  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }

  add(readings: Reading[]): void {
    this.buffer.push(...readings);
    this.metrics.buffered.set(this.buffer.length);
    if (this.buffer.length >= this.maxReadings) void this.flush();
  }

  /** Flushes serially: a slow flush delays the next one instead of racing it. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.writeBuffer());
    return this.flushing;
  }

  private async writeBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    this.metrics.buffered.set(0);

    const stopTimer = this.metrics.flushSeconds.startTimer();
    try {
      const stored = await this.db.transaction(async (client) => {
        const inserted = await client.query<{
          device_id: string;
          metric: string;
          ts: Date;
          value: number;
        }>(
          `INSERT INTO reading (device_id, metric, ts, value)
           SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::float8[])
           ON CONFLICT DO NOTHING
           RETURNING device_id, metric, ts, value`,
          [
            batch.map((r) => r.deviceId),
            batch.map((r) => r.metric),
            batch.map((r) => r.ts),
            batch.map((r) => r.value),
          ],
        );
        const rows: Reading[] = inserted.rows.map((r) => ({
          deviceId: r.device_id,
          metric: r.metric,
          ts: r.ts,
          value: r.value,
        }));

        const buckets = rollup(rows);
        if (buckets.length > 0) {
          await client.query(
            `INSERT INTO rollup_1m (device_id, metric, bucket, count, sum, min, max)
             SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::int[],
                                  $5::float8[], $6::float8[], $7::float8[])
             ON CONFLICT (device_id, metric, bucket) DO UPDATE SET
               count = rollup_1m.count + EXCLUDED.count,
               sum   = rollup_1m.sum + EXCLUDED.sum,
               min   = LEAST(rollup_1m.min, EXCLUDED.min),
               max   = GREATEST(rollup_1m.max, EXCLUDED.max)`,
            [
              buckets.map((b) => b.deviceId),
              buckets.map((b) => b.metric),
              buckets.map((b) => b.bucket),
              buckets.map((b) => b.count),
              buckets.map((b) => b.sum),
              buckets.map((b) => b.min),
              buckets.map((b) => b.max),
            ],
          );
        }
        const lastSeen = new Map<string, Date>();
        for (const r of rows) {
          if ((lastSeen.get(r.deviceId)?.getTime() ?? 0) < r.ts.getTime())
            lastSeen.set(r.deviceId, r.ts);
        }
        if (lastSeen.size > 0) {
          await client.query(
            `UPDATE device d SET last_seen = GREATEST(d.last_seen, v.ts)
             FROM unnest($1::text[], $2::timestamptz[]) AS v(id, ts) WHERE d.id = v.id`,
            [[...lastSeen.keys()], [...lastSeen.values()]],
          );
        }
        return rows;
      });

      const now = Date.now();
      this.metrics.batchSize.observe(batch.length);
      this.metrics.readings.inc({ result: 'stored' }, stored.length);
      this.metrics.readings.inc({ result: 'duplicate' }, batch.length - stored.length);
      for (const r of stored) this.metrics.lagSeconds.observe((now - r.ts.getTime()) / 1000);

      stopTimer();
      await this.evaluateRules(stored);
    } catch (error) {
      stopTimer();
      // The batch is dropped, not retried forever: a poison row must not block ingest.
      this.metrics.readings.inc({ result: 'failed' }, batch.length);
      this.logger.error(`Flush of ${batch.length} readings failed: ${(error as Error).message}`);
    }
  }

  /** Rules see each newly stored reading once, in measurement order. Never fails the write. */
  private async evaluateRules(stored: Reading[]): Promise<void> {
    stored.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    try {
      await this.rules.process(stored);
    } catch (error) {
      this.logger.error(`Rule evaluation failed: ${(error as Error).message}`);
    }
  }
}

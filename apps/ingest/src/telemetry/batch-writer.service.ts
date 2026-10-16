import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import type { Env } from '../config/env.validation';
import { Database } from '../database/database';
import { Metrics } from '../metrics/metrics';
import { RulesService } from '../rules/rules.service';
import { type Reading, rollup } from './rollup';
import { applySequences, type Hole, type SequenceObservation } from './sequence-ledger';

/** A message attributable to a device, whatever became of its readings. */
interface Observation extends SequenceObservation {
  deviceId: string;
}

/**
 * Buffers readings and writes them in batches (ADR-0002, ADR-0003). One flush is one transaction:
 * insert with ON CONFLICT DO NOTHING, then roll up only the rows that were actually inserted —
 * so a redelivered message can never inflate a count. The same transaction updates each touched
 * device's sequence ledger, which is how gaps are counted across replicas (V1-T01).
 */
@Injectable()
export class BatchWriter implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BatchWriter.name);
  private buffer: Reading[] = [];
  private observed: Observation[] = [];
  private timer?: NodeJS.Timeout;
  private flushing: Promise<void> = Promise.resolve();
  private readonly maxReadings: number;
  private readonly intervalMs: number;
  private readonly graceMs: number;

  constructor(
    private readonly db: Database,
    private readonly metrics: Metrics,
    private readonly rules: RulesService,
    config: ConfigService<Env, true>,
  ) {
    this.maxReadings = config.get('FLUSH_MAX_READINGS', { infer: true });
    this.intervalMs = config.get('FLUSH_INTERVAL_MS', { infer: true });
    this.graceMs = config.get('SEQUENCE_GRACE_MS', { infer: true });
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

  /** Records a received message's sequence number: counted even when it is rejected later. */
  observe(deviceId: string, seq: number, ts: number): void {
    this.observed.push({ deviceId, seq, ts });
  }

  /** Flushes serially: a slow flush delays the next one instead of racing it. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.writeBuffer());
    return this.flushing;
  }

  private async writeBuffer(): Promise<void> {
    if (this.buffer.length === 0 && this.observed.length === 0) return;
    const batch = this.buffer;
    const observed = this.observed;
    this.buffer = [];
    this.observed = [];
    this.metrics.buffered.set(0);

    const stopTimer = this.metrics.flushSeconds.startTimer();
    try {
      const { stored, lost } = await this.db.transaction(async (client) => {
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
        const lost = await this.recordDevices(client, rows, observed);
        return { stored: rows, lost };
      });

      const now = Date.now();
      if (batch.length > 0) this.metrics.batchSize.observe(batch.length);
      this.metrics.readings.inc({ result: 'stored' }, stored.length);
      this.metrics.readings.inc({ result: 'duplicate' }, batch.length - stored.length);
      for (const r of stored) this.metrics.lagSeconds.observe((now - r.ts.getTime()) / 1000);
      if (lost > 0) this.metrics.sequenceGaps.inc(lost);

      stopTimer();
      await this.evaluateRules(stored);
    } catch (error) {
      stopTimer();
      // The batch is dropped, not retried forever: a poison row must not block ingest.
      this.metrics.readings.inc({ result: 'failed' }, batch.length);
      this.logger.error(`Flush of ${batch.length} readings failed: ${(error as Error).message}`);
    }
  }

  /**
   * Updates `last_seen` and the sequence ledger of every device the batch touched, under a row lock:
   * replicas that share a device take turns, so each one counts from the other's committed state.
   * `FOR NO KEY UPDATE` does not conflict with the foreign-key locks the inserts hold, and locking in
   * id order keeps two replicas from deadlocking. Returns the messages newly confirmed lost.
   */
  private async recordDevices(
    client: PoolClient,
    stored: Reading[],
    observed: Observation[],
  ): Promise<number> {
    const seqs = new Map<string, SequenceObservation[]>();
    for (const { deviceId, seq, ts } of observed) {
      const list = seqs.get(deviceId);
      if (list) list.push({ seq, ts });
      else seqs.set(deviceId, [{ seq, ts }]);
    }
    const lastSeen = new Map<string, Date>();
    for (const r of stored) {
      if ((lastSeen.get(r.deviceId)?.getTime() ?? 0) < r.ts.getTime())
        lastSeen.set(r.deviceId, r.ts);
    }
    const ids = [...new Set([...seqs.keys(), ...lastSeen.keys()])].sort();
    if (ids.length === 0) return 0;

    const { rows } = await client.query<{
      id: string;
      last_seq: string | null;
      seq_last_ts: Date | null;
      seq_holes: Hole[];
    }>(
      `SELECT id, last_seq, seq_last_ts, seq_holes FROM device WHERE id = ANY($1::text[])
       ORDER BY id FOR NO KEY UPDATE`,
      [ids],
    );

    const now = Date.now();
    let lost = 0;
    const next = rows.map((row) => {
      const result = applySequences(
        {
          last: row.last_seq === null ? null : Number(row.last_seq),
          lastTs: row.seq_last_ts?.getTime() ?? null,
          holes: row.seq_holes,
        },
        seqs.get(row.id) ?? [],
        now,
        this.graceMs,
      );
      lost += result.lost;
      return { id: row.id, ...result.state, lastSeen: lastSeen.get(row.id) ?? null };
    });
    await client.query(
      `UPDATE device d SET last_seq = v.last_seq, seq_last_ts = v.last_ts,
         seq_holes = v.holes::jsonb, last_seen = GREATEST(d.last_seen, v.last_seen)
       FROM unnest($1::text[], $2::bigint[], $3::timestamptz[], $4::text[], $5::timestamptz[])
         AS v(id, last_seq, last_ts, holes, last_seen)
       WHERE d.id = v.id`,
      [
        next.map((d) => d.id),
        next.map((d) => d.last),
        next.map((d) => (d.lastTs === null ? null : new Date(d.lastTs))),
        next.map((d) => JSON.stringify(d.holes)),
        next.map((d) => d.lastSeen),
      ],
    );
    return lost;
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

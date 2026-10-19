import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import type { Env } from '../config/env.validation';
import { Database } from '../database/database';
import { isDataError } from '../database/errors';
import { nextDelayMs } from '../delivery/backoff';
import { runWithContext } from '../logging/log-context';
import { Metrics } from '../metrics/metrics';
import { RulesService } from '../rules/rules.service';
import { type Reading, rollup } from './rollup';
import { applySequences, type Hole, type SequenceObservation } from './sequence-ledger';

/** Retries of a failed flush start at 250 ms and back off, with jitter, to this ceiling. */
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 5_000;

const halves = <T>(items: T[]): [T[], T[]] => {
  const middle = items.length >>> 1;
  return [items.slice(0, middle), items.slice(middle)];
};

/** A message attributable to a device, whatever became of its readings. */
interface Observation extends SequenceObservation {
  deviceId: string;
}

/**
 * Buffers readings and writes them in batches (ADR-0002, ADR-0003). One flush is one transaction:
 * insert with ON CONFLICT DO NOTHING, then roll up only the rows that were actually inserted —
 * so a redelivered message can never inflate a count. The same transaction updates each touched
 * device's sequence ledger, which is how gaps are counted across replicas (V1-T01).
 *
 * A failed flush loses nothing the database is not to blame for (V1-T02): when the failure says
 * nothing about the rows — connection refused, restart, deadlock — the batch stays in the buffer
 * and is retried with backoff, and a full buffer makes the consumer hold back its acknowledgements
 * so the broker queues instead of this process. When PostgreSQL rejects the rows themselves, the
 * batch is written in halves until the offending rows stand alone; only those are dropped.
 */
@Injectable()
export class BatchWriter implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BatchWriter.name);
  private buffer: Reading[] = [];
  private observed: Observation[] = [];
  private timer?: NodeJS.Timeout;
  private flushing: Promise<void> = Promise.resolve();
  /** Readings (or messages) taken out of the buffer by a flush that has not finished yet. */
  private inFlight = 0;
  private failures = 0;
  /**
   * Flush attempts that did work since the process started. Its value names one attempt in the logs
   * (`batchId`): a retry gets a new one, and it is the same range in every replica.
   */
  private flushSeq = 0;
  private retryAt = 0;
  private draining = false;
  private paused = false;
  private waiting: Array<() => void> = [];
  private readonly ceiling: number;
  private readonly maxReadings: number;
  private readonly intervalMs: number;
  private readonly graceMs: number;

  constructor(
    private readonly db: Database,
    private readonly metrics: Metrics,
    private readonly rules: RulesService,
    config: ConfigService<Env, true>,
  ) {
    this.ceiling = config.get('BUFFER_MAX_READINGS', { infer: true });
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
    await this.drain();
  }

  add(readings: Reading[]): void {
    this.buffer.push(...readings);
    this.metrics.buffered.set(this.buffer.length);
    if (this.buffer.length >= this.maxReadings && !this.backingOff) void this.flush();
  }

  /** Records a received message's sequence number: counted even when it is rejected later. */
  observe(deviceId: string, seq: number, ts: number): void {
    this.observed.push({ deviceId, seq, ts });
  }

  /**
   * Resolves at once while the buffer has room. Once it holds `BUFFER_MAX_READINGS`, resolves only
   * after it has drained to half of that: the consumer awaits this before acknowledging a message,
   * which stops the broker connection from delivering more (ITP-11).
   */
  waitForRoom(): Promise<void> {
    if (!this.paused && this.backlog >= this.ceiling) this.setPaused(true);
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  /** Lets every held acknowledgement through. For shutdown, where the buffer is drained next. */
  release(): void {
    this.setPaused(false);
    for (const resolve of this.waiting.splice(0)) resolve();
  }

  /** Flushes serially: a slow flush delays the next one instead of racing it. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.writeBuffer());
    return this.flushing;
  }

  /**
   * Writes what is buffered once more, for shutdown: no waiting out a backoff, no retry afterwards.
   * Readings the database still refuses are counted as failed and logged — the process is leaving.
   * Rule evaluations the database could not take earlier get a last attempt too; what is still
   * pending is logged and lost with the process.
   */
  async drain(): Promise<void> {
    this.draining = true;
    this.release();
    await this.flush();
    await this.retryRulesAtShutdown();
  }

  /**
   * A flush evaluates rules only for the readings it stores, and returns early with nothing buffered,
   * so deferred evaluations need their own call. Never throws: shutdown has to go on.
   */
  private async retryRulesAtShutdown(): Promise<void> {
    try {
      const pending = await this.rules.retryPending();
      if (pending > 0) {
        this.logger.error(`${pending} rule evaluations still pending at shutdown, not applied`);
      }
    } catch (error) {
      this.logger.error(
        `Retrying rule evaluations at shutdown failed: ${(error as Error).message}`,
      );
    }
  }

  /** Readings held in memory: waiting in the buffer, or taken out by a flush still running. */
  private get backlog(): number {
    return Math.max(this.buffer.length, this.observed.length) + this.inFlight;
  }

  private get backingOff(): boolean {
    return !this.draining && Date.now() < this.retryAt;
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.metrics.consumptionPaused.set(paused ? 1 : 0);
  }

  private async writeBuffer(): Promise<void> {
    if (this.buffer.length === 0 && this.observed.length === 0) return;
    if (this.backingOff) return;
    const batch = this.buffer;
    const observed = this.observed;
    this.buffer = [];
    this.observed = [];
    this.inFlight = Math.max(batch.length, observed.length);
    this.metrics.buffered.set(0);

    // Every log line written below carries the id, the rule evaluation lines included.
    await runWithContext({ batchId: String(++this.flushSeq) }, async () => {
      try {
        await this.commit(batch, observed);
        this.failures = 0;
      } catch (error) {
        if (isDataError(error)) await this.isolate(batch, observed);
        else this.retryOrDrop(batch, observed, error);
      } finally {
        this.inFlight = 0;
        if (this.paused && this.backlog <= this.ceiling / 2) this.release();
      }
    });
  }

  /** One flush: a transaction, then the metrics and the rules for what it stored. Throws on failure. */
  private async commit(batch: Reading[], observed: Observation[]): Promise<void> {
    const stopTimer = this.metrics.flushSeconds.startTimer();
    let stored: Reading[];
    let lost: number;
    try {
      ({ stored, lost } = await this.db.transaction(async (client) => {
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
      }));
    } finally {
      stopTimer();
    }

    const now = Date.now();
    if (batch.length > 0) this.metrics.batchSize.observe(batch.length);
    this.metrics.readings.inc({ result: 'stored' }, stored.length);
    this.metrics.readings.inc({ result: 'duplicate' }, batch.length - stored.length);
    for (const r of stored) this.metrics.lagSeconds.observe((now - r.ts.getTime()) / 1000);
    if (lost > 0) this.metrics.sequenceGaps.inc(lost);

    await this.evaluateRules(stored);
  }

  /**
   * The database rejected something in the batch. The sequence numbers go in on their own first —
   * they do not depend on the readings — then the readings are written in halves, recursively, until
   * the rows PostgreSQL objects to are alone: they are dropped and counted, the rest is stored.
   * If the database becomes unavailable on the way, whatever is not written yet is kept for a retry.
   */
  private async isolate(batch: Reading[], observed: Observation[]): Promise<void> {
    // The whole batch just failed, so start from its halves. A single reading is tried alone: the
    // fault may have been in the sequence numbers, which are written first.
    const parts: Reading[][] = batch.length > 1 ? halves(batch) : batch.length === 1 ? [batch] : [];
    let pendingObserved = observed;
    try {
      if (observed.length > 0) {
        try {
          await this.commit([], observed);
        } catch (error) {
          if (!isDataError(error)) throw error;
          this.logger.error(
            `Sequence numbers of ${observed.length} messages dropped: ${(error as Error).message}`,
          );
        }
        pendingObserved = [];
      }
      while (parts.length > 0) {
        const part = parts[0]!;
        try {
          await this.commit(part, []);
          parts.shift();
        } catch (error) {
          if (!isDataError(error)) throw error;
          parts.shift();
          if (part.length > 1) {
            parts.unshift(...halves(part));
          } else {
            this.drop(part, error);
          }
        }
      }
      this.failures = 0;
    } catch (error) {
      this.retryOrDrop(parts.flat(), pendingObserved, error);
    }
  }

  /** Keeps a batch the database is not to blame for, to be tried again after a backoff. */
  private retryOrDrop(batch: Reading[], observed: Observation[], error: unknown): void {
    if (this.draining) return this.drop(batch, error);

    this.failures++;
    const delay = nextDelayMs(this.failures, Math.random, RETRY_BASE_MS, RETRY_MAX_MS);
    this.retryAt = Date.now() + delay;
    this.inFlight = 0;
    this.buffer = batch.concat(this.buffer);
    this.observed = observed.concat(this.observed);
    this.metrics.buffered.set(this.buffer.length);
    this.metrics.flushRetries.inc();
    this.logger.warn(
      `Flush of ${batch.length} readings failed (attempt ${this.failures}), retrying in ${delay} ms: ${(error as Error).message}`,
    );
  }

  /** The only place readings are given up on. They were acknowledged, so this is data lost. */
  private drop(batch: Reading[], error: unknown): void {
    this.metrics.readings.inc({ result: 'failed' }, batch.length);
    this.logger.error(`Dropped ${batch.length} readings: ${(error as Error).message}`);
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

  /**
   * Rules see each newly stored reading once, in measurement order. Never fails the write: the
   * readings have committed. A transient database error does not arrive here (`RulesService`
   * queues it), so what is caught is unexpected.
   */
  private async evaluateRules(stored: Reading[]): Promise<void> {
    stored.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    try {
      await this.rules.process(stored);
    } catch (error) {
      this.logger.error(`Rule evaluation failed unexpectedly: ${(error as Error).message}`);
    }
  }
}

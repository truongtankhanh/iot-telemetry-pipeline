import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import type { Env } from '../config/env.validation';
import type { Database } from '../database/database';
import { Metrics } from '../metrics/metrics';
import type { RulesService } from '../rules/rules.service';
import { BatchWriter } from './batch-writer.service';
import type { Reading } from './rollup';

/** A value the fake database refuses, as PostgreSQL refuses a number out of range. */
const POISON = -999;

interface Row {
  device_id: string;
  metric: string;
  ts: Date;
  value: number;
}

/** Just enough of PostgreSQL for the writer: readings with ON CONFLICT, and the sequence ledger. */
class FakeDatabase {
  down = false;
  transactions = 0;
  beforeTransaction?: (n: number) => void;
  readonly stored: Row[] = [];
  readonly ledger = new Map<string, number>();

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    this.beforeTransaction?.(++this.transactions);
    if (this.down) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });

    const staged: Row[] = [];
    const ledger = new Map(this.ledger);
    const client = {
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO reading')) {
          const [devices, metrics, times, values] = params as [
            string[],
            string[],
            Date[],
            number[],
          ];
          if (values.includes(POISON)) {
            throw Object.assign(new Error('value out of range'), { code: '22003' });
          }
          const key = (r: Row) => `${r.device_id}|${r.metric}|${r.ts.getTime()}`;
          const known = new Set([...this.stored, ...staged].map(key));
          const rows = devices
            .map((device_id, i) => ({
              device_id,
              metric: metrics[i]!,
              ts: times[i]!,
              value: values[i]!,
            }))
            .filter((r) => !known.has(key(r)));
          staged.push(...rows);
          return { rows };
        }
        if (sql.includes('FROM device')) {
          const ids = params[0] as string[];
          return {
            rows: ids.map((id) => ({
              id,
              last_seq: ledger.has(id) ? String(ledger.get(id)) : null,
              seq_last_ts: null,
              seq_holes: [],
            })),
          };
        }
        if (sql.includes('UPDATE device')) {
          const [ids, lasts] = params as [string[], (number | null)[]];
          ids.forEach((id, i) => lasts[i] !== null && ledger.set(id, lasts[i]!));
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as unknown as PoolClient;

    const result = await work(client);
    this.stored.push(...staged);
    ledger.forEach((seq, id) => this.ledger.set(id, seq));
    return result;
  }
}

function setup(overrides: Partial<Record<keyof Env, number>> = {}) {
  const settings: Partial<Record<keyof Env, number>> = {
    FLUSH_MAX_READINGS: 1000,
    FLUSH_INTERVAL_MS: 250,
    SEQUENCE_GRACE_MS: 30_000,
    BUFFER_MAX_READINGS: 10_000,
    ...overrides,
  };
  const db = new FakeDatabase();
  const metrics = new Metrics();
  const config = { get: (key: keyof Env) => settings[key] } as unknown as ConfigService<Env, true>;
  const rules = {
    process: jest.fn().mockResolvedValue(undefined),
    retryPending: jest.fn().mockResolvedValue(0),
  };
  const writer = new BatchWriter(
    db as unknown as Database,
    metrics,
    rules as unknown as RulesService,
    config,
  );

  const value = async (metric: {
    get(): Promise<{ values: { value: number; labels: object }[] }>;
  }) => (await metric.get()).values.reduce((sum, v) => sum + v.value, 0);
  const readings = async (result: string) =>
    (await metrics.readings.get()).values.find(
      (v) => (v.labels as Record<string, string>).result === result,
    )?.value ?? 0;
  return { db, metrics, writer, rules, value, readings };
}

const reading = (n: number, value = n): Reading => ({
  deviceId: 'd1',
  metric: 'temperature_c',
  ts: new Date(1_000 * n),
  value,
});

describe('BatchWriter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps a batch the database is not to blame for and writes it after a backoff', async () => {
    const { db, writer, readings, value, metrics } = setup();
    db.down = true;
    writer.add([reading(1), reading(2)]);
    writer.observe('d1', 1, 1_000);
    await writer.flush();

    expect(db.stored).toHaveLength(0);
    expect(await readings('failed')).toBe(0);
    expect(await value(metrics.flushRetries)).toBe(1);

    // The database is back, but the backoff has not elapsed: no attempt, and new readings queue up.
    db.down = false;
    writer.add([reading(3)]);
    const attempts = db.transactions;
    await writer.flush();
    expect(db.transactions).toBe(attempts);

    jest.advanceTimersByTime(10_000);
    await writer.flush();
    expect(db.stored.map((r) => r.value)).toEqual([1, 2, 3]);
    expect(await readings('stored')).toBe(3);
    expect(await readings('failed')).toBe(0);
    expect(db.ledger.get('d1')).toBe(1);
  });

  it('drops only the reading PostgreSQL rejects and still records the sequence numbers', async () => {
    const { db, writer, readings } = setup();
    writer.add([reading(1), reading(2), reading(3, POISON), reading(4), reading(5)]);
    for (let seq = 1; seq <= 5; seq++) writer.observe('d1', seq, seq * 1_000);
    await writer.flush();

    expect(db.stored.map((r) => r.value)).toEqual([1, 2, 4, 5]);
    expect(await readings('stored')).toBe(4);
    expect(await readings('failed')).toBe(1);
    expect(db.ledger.get('d1')).toBe(5);
  });

  it('loses nothing when the database goes away while a poison row is being isolated', async () => {
    const { db, writer, readings } = setup();
    // 1: whole batch (rejected), 2: first half (rejected), 3: its first reading — the database is gone.
    db.beforeTransaction = (n) => {
      if (n === 3) db.down = true;
    };
    writer.add([reading(1), reading(2, POISON), reading(3), reading(4)]);
    await writer.flush();
    expect(db.stored).toHaveLength(0);
    expect(await readings('failed')).toBe(0);

    db.down = false;
    jest.advanceTimersByTime(10_000);
    await writer.flush();
    expect(db.stored.map((r) => r.value)).toEqual([1, 3, 4]);
    expect(await readings('failed')).toBe(1);
  });

  it('holds acknowledgements while the buffer is full and releases them once it drains', async () => {
    const { db, writer, metrics, value } = setup({ BUFFER_MAX_READINGS: 4 });
    await expect(writer.waitForRoom()).resolves.toBeUndefined();

    db.down = true;
    writer.add([reading(1), reading(2), reading(3), reading(4)]);
    let released = false;
    void writer.waitForRoom().then(() => (released = true));
    await writer.flush(); // fails: the readings stay buffered
    expect(released).toBe(false);
    expect(await value(metrics.consumptionPaused)).toBe(1);

    db.down = false;
    jest.advanceTimersByTime(10_000);
    await writer.flush();
    await Promise.resolve();
    expect(released).toBe(true);
    expect(await value(metrics.consumptionPaused)).toBe(0);
    expect(db.stored).toHaveLength(4);
  });

  it('gives up on what the database still refuses when draining for shutdown', async () => {
    const { db, writer, readings, value, metrics } = setup();
    db.down = true;
    writer.add([reading(1), reading(2), reading(3)]);
    await writer.drain();

    expect(await readings('failed')).toBe(3);
    expect(await value(metrics.flushRetries)).toBe(0);
    await writer.drain();
    expect(await readings('failed')).toBe(3);
  });

  it('lets held acknowledgements through when draining', async () => {
    const { db, writer } = setup({ BUFFER_MAX_READINGS: 2 });
    db.down = true;
    writer.add([reading(1), reading(2)]);
    let released = false;
    void writer.waitForRoom().then(() => (released = true));
    await writer.drain();
    await Promise.resolve();
    expect(released).toBe(true);
  });

  describe('rule evaluation at shutdown', () => {
    let error: jest.SpyInstance;

    beforeEach(() => {
      error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('retries the pending evaluations once, after the flush', async () => {
      const { db, writer, rules } = setup();
      let storedWhenCalled = -1;
      rules.retryPending.mockImplementation(async () => {
        storedWhenCalled = db.stored.length;
        return 0;
      });
      writer.add([reading(1), reading(2)]);

      await writer.drain();

      expect(rules.retryPending).toHaveBeenCalledTimes(1);
      expect(storedWhenCalled).toBe(2);
      expect(error).not.toHaveBeenCalled();
    });

    it('logs how many evaluations are still pending', async () => {
      const { writer, rules } = setup();
      rules.retryPending.mockResolvedValue(3);

      await writer.drain();

      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('3 rule evaluations still pending at shutdown'),
      );
    });

    it('does not let a failing retry stop the shutdown', async () => {
      const { writer, rules } = setup();
      rules.retryPending.mockRejectedValue(new Error('pool is closed'));

      await expect(writer.drain()).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('pool is closed'));
    });

    it('retries once per call and stays quiet when nothing is pending', async () => {
      const { writer, rules, readings } = setup();
      writer.add([reading(1)]);

      await writer.drain();
      await writer.drain();

      expect(rules.retryPending).toHaveBeenCalledTimes(2);
      expect(error).not.toHaveBeenCalled();
      expect(await readings('stored')).toBe(1);
    });

    it('words an unexpected rule failure as such, and still keeps the readings', async () => {
      const { db, writer, rules } = setup();
      rules.process.mockRejectedValue(new Error('boom'));
      writer.add([reading(1), reading(2)]);

      await writer.flush();

      expect(db.stored).toHaveLength(2);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Rule evaluation failed unexpectedly: boom'),
      );
    });
  });
});

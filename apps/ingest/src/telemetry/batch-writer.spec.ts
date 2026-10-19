import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import type { Env } from '../config/env.validation';
import type { Database } from '../database/database';
import { currentContext } from '../logging/log-context';
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
  /** While set, every transaction throws it, whatever its code. */
  failure?: Error;
  /** While set, the ledger update fails as PostgreSQL would for a sequence number out of range. */
  poisonSequences = false;
  transactions = 0;
  beforeTransaction?: (n: number) => void;
  readonly stored: Row[] = [];
  /** The arrays each `rollup_1m` upsert was sent with. */
  readonly rollups: { deviceIds: string[]; metrics: string[]; buckets: Date[] }[] = [];
  readonly ledger = new Map<string, number>();

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    this.beforeTransaction?.(++this.transactions);
    if (this.down) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    if (this.failure) throw this.failure;

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
        if (sql.includes('INSERT INTO rollup_1m')) {
          const [deviceIds, metrics, buckets] = params as [string[], string[], Date[]];
          this.rollups.push({ deviceIds, metrics, buckets });
          return { rows: [] };
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
          // Only an update that carries a sequence number is refused, so the readings of the same
          // batch can still be written on their own.
          if (this.poisonSequences && lasts.some((last) => last !== null)) {
            throw Object.assign(new Error('sequence number out of range'), { code: '22003' });
          }
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

  it('keeps and retries a batch whose statement was cancelled by the statement timeout (57014)', async () => {
    const { db, writer, readings, value, metrics } = setup();
    db.failure = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    });
    writer.add([reading(1), reading(2)]);
    writer.observe('d1', 1, 1_000);
    await writer.flush();

    // Not the data's fault, so nothing is dropped: it waits for the next attempt.
    expect(db.stored).toHaveLength(0);
    expect(await readings('failed')).toBe(0);
    expect(await value(metrics.flushRetries)).toBe(1);

    db.failure = undefined;
    jest.advanceTimersByTime(10_000);
    await writer.flush();
    expect(db.stored.map((r) => r.value)).toEqual([1, 2]);
    expect(await readings('failed')).toBe(0);
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

  describe('batch id', () => {
    interface Line {
      level: 'log' | 'warn' | 'error';
      message: string;
      batchId: string | undefined;
    }
    let lines: Line[];

    /**
     * Records every line the loggers are asked to write, with the batch id of the context it is
     * written in. The id is added to the JSON object later, by the installed logger, so the message
     * string alone cannot show it; the context is read at the moment of the call.
     */
    beforeEach(() => {
      lines = [];
      const record = (level: Line['level'], message: unknown) =>
        lines.push({ level, message: String(message), batchId: currentContext().batchId });
      jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
        record('log', message);
      });
      jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
        record('warn', message);
      });
      jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
        record('error', message);
      });
    });
    afterEach(() => jest.restoreAllMocks());

    const line = (start: string): Line | undefined =>
      lines.find((l) => l.message.startsWith(start));

    it('puts an id on the warning of a flush that failed', async () => {
      const { db, writer } = setup();
      db.down = true;
      writer.add([reading(1), reading(2)]);

      await writer.flush();

      expect(line('Flush of 2 readings failed')?.batchId).toMatch(/^\d+$/);
    });

    it('gives each flush attempt its own id', async () => {
      const { db, writer } = setup();
      db.down = true;
      writer.add([reading(1)]);

      await writer.flush();
      jest.advanceTimersByTime(10_000);
      await writer.flush();

      const ids = lines.filter((l) => l.message.startsWith('Flush of')).map((l) => l.batchId);
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
    });

    it('does not spend an id on a tick with nothing to write or on one that is backing off', async () => {
      const { db, writer } = setup();
      db.down = true;

      await writer.flush(); // nothing buffered
      writer.add([reading(1)]);
      await writer.flush(); // the first attempt
      await writer.flush(); // backing off: returns without trying
      jest.advanceTimersByTime(10_000);
      await writer.flush(); // the second attempt

      expect(lines.map((l) => l.batchId)).toEqual(['1', '2']);
    });

    it('gives the lines of the rules and the drop of one flush the same id', async () => {
      const { db, writer, rules } = setup();
      rules.process.mockImplementation(async () => {
        new Logger('RulesService').warn('Rule evaluation deferred, 1 pending: down');
      });
      writer.add([reading(1), reading(2, POISON), reading(3), reading(4)]);

      await writer.flush();

      const dropped = line('Dropped 1 readings');
      const fromRules = lines.filter((l) => l.message.startsWith('Rule evaluation deferred'));
      expect(db.stored.map((r) => r.value)).toEqual([1, 3, 4]);
      expect(dropped?.batchId).toMatch(/^\d+$/);
      expect(fromRules.length).toBeGreaterThan(0);
      expect(fromRules.every((l) => l.batchId === dropped?.batchId)).toBe(true);
    });

    it('puts an id on the drop of sequence numbers and still stores the readings', async () => {
      const { db, writer } = setup();
      db.poisonSequences = true;
      writer.add([reading(1), reading(2)]);
      writer.observe('d1', 1, 1_000);
      writer.observe('d1', 2, 2_000);

      await writer.flush();

      expect(line('Sequence numbers of 2 messages dropped')?.batchId).toMatch(/^\d+$/);
      expect(db.stored.map((r) => r.value)).toEqual([1, 2]);
    });

    it('puts an id on the drop of a drain', async () => {
      const { db, writer } = setup();
      db.down = true;
      writer.add([reading(1), reading(2), reading(3)]);

      await writer.drain();

      expect(line('Dropped 3 readings')?.batchId).toMatch(/^\d+$/);
    });

    it('leaves the lines about rule evaluations at shutdown without an id: they are not a flush', async () => {
      const { writer, rules } = setup();
      rules.retryPending
        .mockResolvedValueOnce(3)
        .mockRejectedValueOnce(new Error('pool is closed'));

      await writer.drain();
      await writer.drain();

      expect(line('3 rule evaluations still pending at shutdown')).toMatchObject({
        level: 'error',
        batchId: undefined,
      });
      expect(line('Retrying rule evaluations at shutdown failed')).toMatchObject({
        level: 'error',
        batchId: undefined,
      });
    });

    it('writes no line for a flush that succeeds, and leaves no context behind', async () => {
      const { writer } = setup();
      writer.add([reading(1), reading(2)]);

      await writer.flush();

      expect(lines).toEqual([]);
      expect(currentContext()).toEqual({});
    });
  });

  it('sends the rollup rows sorted by device, metric and minute, so replicas lock them in one order', async () => {
    const { db, writer } = setup();
    const at = (deviceId: string, metric: string, minute: number): Reading => ({
      deviceId,
      metric,
      ts: new Date(minute * 60_000 + 5_000),
      value: 1,
    });
    writer.add([
      at('d2', 'temperature_c', 5),
      at('d1', 'temperature_c', 9),
      at('d1', 'humidity_pct', 2),
      at('d1', 'temperature_c', 3),
      at('d2', 'humidity_pct', 1),
    ]);

    await writer.flush();

    expect(db.rollups).toHaveLength(1);
    const { deviceIds, metrics, buckets } = db.rollups[0]!;
    expect(deviceIds.map((d, i) => [d, metrics[i], buckets[i]!.getTime()])).toEqual([
      ['d1', 'humidity_pct', 2 * 60_000],
      ['d1', 'temperature_c', 3 * 60_000],
      ['d1', 'temperature_c', 9 * 60_000],
      ['d2', 'humidity_pct', 1 * 60_000],
      ['d2', 'temperature_c', 5 * 60_000],
    ]);
  });
});

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import type { Env } from '../config/env.validation';
import type { Database } from '../database/database';
import { parseDevices, type DevicesService } from '../devices/devices.service';
import { Metrics } from '../metrics/metrics';
import type { Reading } from '../telemetry/rollup';
import { MAX_PENDING, RulesService } from './rules.service';

const CONFIG_DIR = join(__dirname, '../../config');

/** `server-room-hot` on `dc-env-01`: temperature_c, raise above 27, clear below 25.5, for 3. */
const BREACH = 28;
const IN_RANGE = 22;

interface AlertRow {
  id: number;
  device_id: string;
  rule_id: string;
  status: 'open' | 'cleared';
}

/** Just enough of PostgreSQL for the rules: open alerts with their unique index, and the outbox. */
class FakeDatabase {
  readonly alerts: AlertRow[] = [];
  deliveries = 0;
  /** While set, every transaction throws it (the database is unreachable). */
  failure?: Error;
  /** While set, `query` (the state lookup) throws it. */
  queryFailure?: Error;
  maxConcurrent = 0;
  private active = 0;

  async query(_sql: string, params: unknown[]) {
    if (this.queryFailure) throw this.queryFailure;
    const [devices, rules] = params as [string[], string[]];
    const rows = this.alerts
      .filter(
        (a) =>
          a.status === 'open' &&
          devices.some((d, i) => d === a.device_id && rules[i] === a.rule_id),
      )
      .map((a) => ({ device_id: a.device_id, rule_id: a.rule_id }));
    return { rows };
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    this.maxConcurrent = Math.max(this.maxConcurrent, ++this.active);
    try {
      await Promise.resolve(); // a real round trip lets a second caller interleave
      if (this.failure) throw this.failure;
      const client = {
        query: async (sql: string, params: unknown[]) => {
          const [deviceId, ruleId] = params as string[];
          const open = () =>
            this.alerts.find(
              (a) => a.status === 'open' && a.device_id === deviceId && a.rule_id === ruleId,
            );
          if (sql.includes('INSERT INTO alert_delivery')) {
            this.deliveries++;
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO alert')) {
            if (open()) return { rows: [] }; // ON CONFLICT DO NOTHING
            const row: AlertRow = {
              id: this.alerts.length + 1,
              device_id: deviceId!,
              rule_id: ruleId!,
              status: 'open',
            };
            this.alerts.push(row);
            return { rows: [{ id: String(row.id) }] };
          }
          if (sql.includes('UPDATE alert')) {
            const row = open();
            if (!row) return { rows: [] };
            row.status = 'cleared';
            return { rows: [{ id: String(row.id) }] };
          }
          return { rows: [] };
        },
      } as unknown as PoolClient;
      return await work(client);
    } finally {
      this.active--;
    }
  }
}

function setup() {
  const list = parseDevices(JSON.parse(readFileSync(join(CONFIG_DIR, 'devices.json'), 'utf8')));
  const devices = {
    all: () => list,
    get: (id: string) => list.find((d) => d.id === id),
  } as unknown as DevicesService;
  const config = {
    get: (key: keyof Env) => (key === 'CONFIG_DIR' ? CONFIG_DIR : undefined),
  } as unknown as ConfigService<Env, true>;
  const db = new FakeDatabase();
  const metrics = new Metrics();
  const service = new RulesService(db as unknown as Database, devices, metrics, config);

  let n = 0;
  const reading = (value: number): Reading => ({
    deviceId: 'dc-env-01',
    metric: 'temperature_c',
    ts: new Date(1_000 * ++n),
    value,
  });
  const sum = async (metric: { get(): Promise<{ values: { value: number }[] }> }) =>
    (await metric.get()).values.reduce((total, v) => total + v.value, 0);
  const transitions = async (transition: string) =>
    (await metrics.alertTransitions.get()).values.find(
      (v) => (v.labels as Record<string, string>).transition === transition,
    )?.value ?? 0;
  return {
    db,
    service,
    breach: () => reading(BREACH),
    inRange: () => reading(IN_RANGE),
    pending: () => sum(metrics.evaluationPending),
    dropped: () => sum(metrics.evaluationDropped),
    opened: () => transitions('opened'),
    cleared: () => transitions('cleared'),
  };
}

const connectionLost = () =>
  Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });

describe('RulesService', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens one alert after three breaches', async () => {
    const t = setup();

    await t.service.process([t.breach(), t.breach(), t.breach()]);

    expect(t.db.alerts).toHaveLength(1);
    expect(t.db.alerts[0]!.status).toBe('open');
    expect(t.db.deliveries).toBe(1);
    expect(await t.opened()).toBe(1);
    expect(await t.pending()).toBe(0);
  });

  it('does not advance the state past a failed open, and opens once the database is back', async () => {
    const t = setup();
    t.db.failure = connectionLost();

    await t.service.process([t.breach(), t.breach(), t.breach()]);

    expect(t.db.alerts).toHaveLength(0);
    expect(await t.pending()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('deferred'));

    t.db.failure = undefined;
    await expect(t.service.retryPending()).resolves.toBe(0);

    expect(t.db.alerts).toHaveLength(1);
    expect(t.db.deliveries).toBe(1);
    expect(await t.opened()).toBe(1);
    expect(await t.pending()).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('caught up'));
  });

  it('keeps the alert open after a failed clear and clears it once the database is back', async () => {
    const t = setup();
    await t.service.process([t.breach(), t.breach(), t.breach()]);
    t.db.failure = connectionLost();

    await t.service.process([t.inRange()]);

    expect(t.db.alerts[0]!.status).toBe('open');
    expect(await t.pending()).toBe(1);
    expect(await t.cleared()).toBe(0);

    t.db.failure = undefined;
    await expect(t.service.retryPending()).resolves.toBe(0);

    expect(t.db.alerts[0]!.status).toBe('cleared');
    expect(await t.cleared()).toBe(1);

    // The state moved to closed only after the write: another in-range reading is no transition.
    await t.service.process([t.inRange()]);
    expect(await t.cleared()).toBe(1);
    expect(t.db.deliveries).toBe(2);
  });

  it('drops an item the database rejects as bad data, and leaves the state as it was', async () => {
    const t = setup();
    t.db.failure = Object.assign(new Error('violates check constraint'), { code: '23514' });

    await t.service.process([t.breach(), t.breach(), t.breach()]);

    expect(await t.dropped()).toBe(1);
    expect(await t.pending()).toBe(0);
    expect(t.db.alerts).toHaveLength(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('server-room-hot'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('dc-env-01'));

    // Not retried, even with a healthy database.
    t.db.failure = undefined;
    await expect(t.service.retryPending()).resolves.toBe(0);
    expect(t.db.alerts).toHaveLength(0);

    // The streak was left at 2, so the next breach is the third and opens the alert.
    await t.service.process([t.breach()]);
    expect(t.db.alerts).toHaveLength(1);
  });

  it('queues everything when the state lookup fails, and ends as an uninterrupted run', async () => {
    const t = setup();
    t.db.queryFailure = connectionLost();

    await t.service.process([t.breach(), t.breach(), t.breach()]);

    expect(await t.pending()).toBe(3);
    expect(t.db.alerts).toHaveLength(0);

    t.db.queryFailure = undefined;
    await expect(t.service.retryPending()).resolves.toBe(0);

    const uninterrupted = setup();
    await uninterrupted.service.process([
      uninterrupted.breach(),
      uninterrupted.breach(),
      uninterrupted.breach(),
    ]);
    expect(t.db.alerts).toEqual(uninterrupted.db.alerts);
    expect(t.db.deliveries).toBe(uninterrupted.db.deliveries);
    expect(await t.opened()).toBe(1);
  });

  it('applies pending items before newer ones', async () => {
    const t = setup();
    t.db.failure = connectionLost();
    await t.service.process([t.breach(), t.breach(), t.breach()]); // the third fails to open
    await t.service.process([t.inRange()]); // queued behind it while the database is still down
    expect(await t.pending()).toBe(2);

    t.db.failure = undefined;
    await expect(t.service.retryPending()).resolves.toBe(0);

    // Opened by the third breach, then cleared by the in-range reading. In the wrong order the
    // in-range reading would reset the streak first and no alert would exist at all.
    expect(t.db.alerts).toHaveLength(1);
    expect(t.db.alerts[0]!.status).toBe('cleared');
    expect(await t.opened()).toBe(1);
    expect(await t.cleared()).toBe(1);
  });

  it('bounds the pending queue and counts what it drops', async () => {
    const t = setup();
    t.db.failure = connectionLost();
    const total = MAX_PENDING + 500;

    await t.service.process(Array.from({ length: total }, () => t.breach()));

    // The first two breaches are applied (streak 2); the third fails and it and the rest are queued.
    const queued = total - 2;
    expect(await t.pending()).toBe(MAX_PENDING);
    expect(await t.dropped()).toBe(queued - MAX_PENDING);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('full'));
  });

  it('runs concurrent calls one at a time', async () => {
    const t = setup();
    t.db.failure = connectionLost();
    await t.service.process([t.breach(), t.breach(), t.breach()]);
    t.db.failure = undefined;
    t.db.maxConcurrent = 0;

    await expect(
      Promise.all([t.service.retryPending(), t.service.retryPending()]),
    ).resolves.toEqual([0, 0]);

    expect(t.db.maxConcurrent).toBe(1);
    expect(t.db.alerts).toHaveLength(1);
    expect(await t.opened()).toBe(1);
  });
});

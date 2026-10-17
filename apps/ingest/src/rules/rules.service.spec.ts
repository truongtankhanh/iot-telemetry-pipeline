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
import { MAX_PENDING, RECONCILE_INTERVAL_MS, RulesService } from './rules.service';

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
  /** While set, the state lookup sees no open alert although the insert still conflicts with one. */
  hideOpenFromLookup = false;
  queries = 0;
  transactions = 0;
  maxConcurrent = 0;
  private active = 0;

  /** Comparisons of the cached state with the table (the one query that takes no parameters). */
  reconciles = 0;

  async query(_sql: string, params?: unknown[]) {
    this.queries++;
    if (this.queryFailure) throw this.queryFailure;
    if (!params) {
      this.reconciles++;
      const rows = this.alerts
        .filter((a) => a.status === 'open')
        .map((a) => ({ device_id: a.device_id, rule_id: a.rule_id }));
      return { rows };
    }
    if (this.hideOpenFromLookup) return { rows: [] };
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
    this.transactions++;
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

/** One replica; pass another's `db` to share the table with it. */
function setup(db = new FakeDatabase()) {
  const list = parseDevices(JSON.parse(readFileSync(join(CONFIG_DIR, 'devices.json'), 'utf8')));
  const devices = {
    all: () => list,
    get: (id: string) => list.find((d) => d.id === id),
  } as unknown as DevicesService;
  const config = {
    get: (key: keyof Env) => (key === 'CONFIG_DIR' ? CONFIG_DIR : undefined),
  } as unknown as ConfigService<Env, true>;
  const metrics = new Metrics();
  const service = new RulesService(db as unknown as Database, devices, metrics, config);

  let n = 0;
  const readingOf = (deviceId: string, metric: string, value: number): Reading => ({
    deviceId,
    metric,
    ts: new Date(1_000 * ++n),
    value,
  });
  const reading = (value: number) => readingOf('dc-env-01', 'temperature_c', value);
  const sum = async (metric: { get(): Promise<{ values: { value: number }[] }> }) =>
    (await metric.get()).values.reduce((total, v) => total + v.value, 0);
  const transitions = async (transition: string) =>
    (await metrics.alertTransitions.get()).values.find(
      (v) => (v.labels as Record<string, string>).transition === transition,
    )?.value ?? 0;
  return {
    db,
    service,
    readingOf,
    breach: () => reading(BREACH),
    inRange: () => reading(IN_RANGE),
    pending: () => sum(metrics.evaluationPending),
    dropped: () => sum(metrics.evaluationDropped),
    opened: () => transitions('opened'),
    cleared: () => transitions('cleared'),
    corrections: async (direction: string) =>
      (await metrics.stateCorrections.get()).values.find(
        (v) => (v.labels as Record<string, string>).direction === direction,
      )?.value ?? 0,
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

  describe('state and lookups', () => {
    const openAlert = (): AlertRow => ({
      id: 1,
      device_id: 'dc-env-01',
      rule_id: 'server-room-hot',
      status: 'open',
    });

    it('rebuilds an open alert from the table on a cache miss, and clears it', async () => {
      const t = setup();
      t.db.alerts.push(openAlert());

      await t.service.process([t.inRange()]);

      expect(t.db.alerts[0]!.status).toBe('cleared');
      expect(t.db.deliveries).toBe(1);
      expect(await t.cleared()).toBe(1);
      expect(await t.opened()).toBe(0);
    });

    it('opens nothing for breaches while the table already holds the open alert', async () => {
      const t = setup();
      t.db.alerts.push(openAlert());

      await t.service.process([t.breach(), t.breach(), t.breach()]);

      expect(t.db.alerts).toHaveLength(1);
      expect(t.db.deliveries).toBe(0);
      expect(await t.opened()).toBe(0);
      expect(t.db.transactions).toBe(0);
    });

    it('writes no outbox row and counts nothing when another replica opened first', async () => {
      const t = setup();
      t.db.alerts.push(openAlert());
      t.db.hideOpenFromLookup = true; // the lookup ran before the other replica's insert

      await t.service.process([t.breach(), t.breach(), t.breach()]);

      expect(t.db.alerts).toHaveLength(1);
      expect(t.db.deliveries).toBe(0);
      expect(await t.opened()).toBe(0);
      expect(t.db.transactions).toBe(1);

      // The state advanced to open, so the next breach does not try again.
      await t.service.process([t.breach()]);
      expect(t.db.transactions).toBe(1);
    });

    it('writes no outbox row and counts nothing when another replica cleared first', async () => {
      const t = setup();
      await t.service.process([t.breach(), t.breach(), t.breach()]);
      expect(t.db.deliveries).toBe(1);
      t.db.alerts[0]!.status = 'cleared'; // cleared elsewhere

      await t.service.process([t.inRange()]);

      expect(t.db.deliveries).toBe(1);
      expect(await t.cleared()).toBe(0);

      // The state is closed: three more breaches open a new alert.
      await t.service.process([t.breach(), t.breach(), t.breach()]);
      expect(t.db.alerts).toHaveLength(2);
      expect(t.db.alerts[1]!.status).toBe('open');
    });

    it('ignores readings of an unregistered device and of a metric with no rule', async () => {
      const t = setup();

      await t.service.process([
        t.readingOf('ghost-01', 'temperature_c', BREACH),
        t.readingOf('lib-air-01', 'temperature_c', BREACH), // indoor_air has a rule for co2_ppm only
      ]);

      expect(t.db.queries).toBe(0);
      expect(t.db.transactions).toBe(0);
      expect(await t.pending()).toBe(0);
    });

    it('returns the incident type configured for a rule', () => {
      const t = setup();

      expect(t.service.incidentType('server-room-hot')).toBe('equipment_fault');
      expect(t.service.incidentType('indoor-co2')).toBe('hvac_fault');
      expect(t.service.incidentType('no-such-rule')).toBeUndefined();
    });
  });

  describe('state that two replicas share only through the table', () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z') }));
    afterEach(() => jest.useRealTimers());
    const later = () => jest.setSystemTime(Date.now() + RECONCILE_INTERVAL_MS);

    it('clears an alert that another replica opened after this one cached it as closed', async () => {
      const a = setup();
      const b = setup(a.db);
      await b.service.process([b.inRange()]); // b caches (dc-env-01, server-room-hot) as closed
      await a.service.process([a.breach(), a.breach(), a.breach()]);
      expect(a.db.alerts[0]!.status).toBe('open');

      later();
      await b.service.process([b.inRange(), b.inRange()]);

      expect(a.db.alerts[0]!.status).toBe('cleared');
      expect(await b.cleared()).toBe(1);
      expect(await b.corrections('to_open')).toBe(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 now open'));
    });

    it('opens a new alert after another replica cleared the one this one cached as open', async () => {
      const a = setup();
      const b = setup(a.db);
      await a.service.process([a.breach(), a.breach(), a.breach()]);
      await b.service.process([b.breach()]); // b loads the open alert from the table
      await a.service.process([a.inRange()]); // a clears it; b still caches it as open
      expect(a.db.alerts[0]!.status).toBe('cleared');

      later();
      await b.service.process([b.breach(), b.breach(), b.breach()]);

      expect(a.db.alerts).toHaveLength(2);
      expect(a.db.alerts[1]!.status).toBe('open');
      expect(await b.opened()).toBe(1);
      expect(await b.corrections('to_closed')).toBe(1);
    });

    it('compares with the table at most once per interval', async () => {
      const t = setup();
      await t.service.process([t.inRange()]); // first sight: nothing cached yet, nothing to compare
      expect(t.db.reconciles).toBe(0);

      await t.service.process([t.inRange()]);
      expect(t.db.reconciles).toBe(0);

      later();
      await t.service.process([t.inRange()]);
      expect(t.db.reconciles).toBe(1);

      await t.service.process([t.inRange()]);
      expect(t.db.reconciles).toBe(1);
    });

    it('logs and counts nothing when the cached state already matches the table', async () => {
      const t = setup();
      await t.service.process([t.breach(), t.breach(), t.breach()]); // opens: cache and table agree

      later();
      await t.service.process([t.breach()]);

      expect(t.db.reconciles).toBe(1);
      expect(await t.corrections('to_open')).toBe(0);
      expect(await t.corrections('to_closed')).toBe(0);
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('corrected'));
    });

    it('goes on evaluating with the cached state when the comparison fails', async () => {
      const t = setup();
      await t.service.process([t.breach(), t.breach()]); // streak 2, cached and closed
      later();
      t.db.queryFailure = connectionLost();

      await t.service.process([t.breach()]); // the third breach

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('reconcile failed'));
      expect(t.db.alerts).toHaveLength(1); // opened with the state it had
      expect(await t.pending()).toBe(0);
    });
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

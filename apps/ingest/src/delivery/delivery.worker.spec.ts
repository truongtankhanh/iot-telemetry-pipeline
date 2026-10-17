import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import type { PoolClient } from 'pg';
import type { Database } from '../database/database';
import type { DevicesService } from '../devices/devices.service';
import { Metrics } from '../metrics/metrics';
import type { RulesService } from '../rules/rules.service';
import { type AlertForDelivery, type AlertSink, RetryLater } from './alert-sink';
import { MAX_ATTEMPTS } from './backoff';
import { DeliveryWorker, LEASE_MS, WAITING_RETRY_MS } from './delivery.worker';

/** Only what the bootstrap hook touches is real: the logger, the config and the sink name. */
function workerWith(sinkName: string): DeliveryWorker {
  const config = {
    get: (key: keyof Env) => (key === 'DELIVERY_INTERVAL_MS' ? 1_000 : undefined),
  } as unknown as ConfigService<Env, true>;
  return new DeliveryWorker(
    {} as unknown as Database,
    {} as unknown as DevicesService,
    {} as unknown as RulesService,
    {} as unknown as Metrics,
    config,
    { name: sinkName } as unknown as AlertSink,
  );
}

describe('DeliveryWorker bootstrap', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let worker: DeliveryWorker | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(async () => {
    // Clears the delivery interval the hook started.
    await worker?.beforeApplicationShutdown();
    worker = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('warns once when there is no command center, and does not log it as a plain boot line', () => {
    worker = workerWith('none');

    worker.onApplicationBootstrap();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Alert sink: none'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Set OCC_API_URL'));
    expect(log).not.toHaveBeenCalled();
  });

  it('logs the sink name without a warning when a command center is configured', () => {
    worker = workerWith('ops-command-center');

    worker.onApplicationBootstrap();

    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Alert sink: ops-command-center');
  });

  it('starts the delivery interval either way, and shutdown clears it', async () => {
    worker = workerWith('none');

    worker.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(1);

    await worker.beforeApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
  });
});

interface OutboxRow {
  delivery_id: string;
  event: 'opened' | 'cleared';
  attempts: number;
  alert_id: string;
  device_id: string;
  rule_id: string;
  metric: string;
  severity: string;
  title: string;
  opened_at: Date;
  opened_value: number;
  cleared_at: Date | null;
  cleared_value: number | null;
  status: 'pending' | 'delivered' | 'skipped' | 'failed';
  last_error: string | null;
  /** Milliseconds since the epoch: not due before it. */
  next_attempt: number;
  /** Milliseconds since the epoch: leased to a worker until then, or not leased. */
  locked_until: number | null;
  /** Seconds until the next attempt, as the last retry update set it. */
  delay_secs?: number;
}

/**
 * Just enough of PostgreSQL for the worker: the outbox rows with their lease and the
 * `external_ref` of each alert. All knowledge of the worker's SQL lives in `run` below, so a change
 * to the statements is a change to this one place, not to the cases. Time is `Date.now()`, so a
 * case moves it with fake timers.
 */
class FakeOutbox {
  readonly rows: OutboxRow[] = [];
  readonly refs = new Map<string, string | null>();
  /** While set, every query and transaction throws it (the database is unreachable). */
  failure?: Error;
  /** While set, only transactions throw it (the result cannot be recorded). */
  transactionFailure?: Error;
  /** Transactions open right now: must be 0 while the command center is being called. */
  active = 0;
  private n = 0;

  add(overrides: Partial<OutboxRow> = {}): OutboxRow {
    const row: OutboxRow = {
      delivery_id: String(++this.n),
      event: 'opened',
      attempts: 0,
      alert_id: '1',
      device_id: 'dc-env-01',
      rule_id: 'indoor-co2',
      metric: 'co2_ppm',
      severity: 'medium',
      title: 'Poor air quality (CO₂)',
      opened_at: new Date('2026-10-17T08:00:00Z'),
      opened_value: 1300,
      cleared_at: null,
      cleared_value: null,
      status: 'pending',
      last_error: null,
      next_attempt: 0,
      locked_until: null,
      ...overrides,
    };
    this.rows.push(row);
    return row;
  }

  async query(sql: string, params: unknown[] = []) {
    await Promise.resolve(); // a real round trip lets a second caller interleave
    if (this.failure) throw this.failure;
    return this.run(sql, params);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    this.active++;
    try {
      await Promise.resolve();
      if (this.failure) throw this.failure;
      if (this.transactionFailure) throw this.transactionFailure;
      return await work({
        query: (sql: string, params: unknown[]) => this.query(sql, params),
      } as PoolClient);
    } finally {
      this.active--;
    }
  }

  private run(sql: string, params: unknown[]): { rows: unknown[]; rowCount: number } {
    const byId = (id: unknown) => this.rows.find((r) => r.delivery_id === id)!;
    const now = Date.now();
    if (sql.includes('WITH next AS')) {
      const [leaseSecs] = params as [number];
      const row = this.rows.find(
        (r) =>
          r.status === 'pending' &&
          r.next_attempt <= now &&
          (r.locked_until === null || r.locked_until <= now),
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.locked_until = now + leaseSecs * 1000;
      return { rows: [{ ...row, external_ref: this.refs.get(row.alert_id) ?? null }], rowCount: 1 };
    }
    if (sql.includes('UPDATE alert SET external_ref')) {
      const [alertId, ref] = params as [string, string];
      this.refs.set(alertId, ref);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT external_ref FROM alert')) {
      const [alertId] = params as [string];
      return { rows: [{ external_ref: this.refs.get(alertId) ?? null }], rowCount: 1 };
    }
    if (sql.includes('UPDATE alert_delivery') && sql.includes('delivered_at')) {
      const [id, status] = params as [string, OutboxRow['status']];
      const row = byId(id);
      if (row.status !== 'pending') return { rows: [], rowCount: 0 };
      Object.assign(row, {
        status,
        attempts: row.attempts + 1,
        last_error: null,
        locked_until: null,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SELECT status FROM alert_delivery')) {
      const [alertId] = params as [string];
      const opened = this.rows.find((r) => r.alert_id === alertId && r.event === 'opened');
      return { rows: opened ? [{ status: opened.status }] : [], rowCount: opened ? 1 : 0 };
    }
    if (sql.includes('UPDATE alert_delivery SET last_error')) {
      const [id, lastError, delaySecs] = params as [string, string, number];
      const row = byId(id);
      if (row.status !== 'pending') return { rows: [], rowCount: 0 };
      Object.assign(row, {
        last_error: lastError,
        delay_secs: delaySecs,
        next_attempt: now + delaySecs * 1000,
        locked_until: null,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE alert_delivery SET status = $2, last_error')) {
      const [id, status, lastError] = params as [string, OutboxRow['status'], string];
      const row = byId(id);
      if (row.status !== 'pending') return { rows: [], rowCount: 0 };
      Object.assign(row, { status, last_error: lastError, locked_until: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE alert_delivery')) {
      const [id, attempts, status, lastError, delaySecs] = params as [
        string,
        number,
        OutboxRow['status'],
        string,
        number,
      ];
      const row = byId(id);
      if (row.status !== 'pending') return { rows: [], rowCount: 0 };
      Object.assign(row, {
        attempts,
        status,
        last_error: lastError,
        delay_secs: delaySecs,
        next_attempt: now + delaySecs * 1000,
        locked_until: null,
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`FakeOutbox: unexpected SQL: ${sql}`);
  }
}

function sinkNamed(name = 'ops-command-center') {
  return {
    name,
    opened: jest.fn(async (_alert: AlertForDelivery): Promise<string | null> => 'incident-1'),
    cleared: jest.fn(async (_alert: AlertForDelivery): Promise<void> => undefined),
  };
}

/** A worker over `outbox` (a new one by default); pass another's outbox to share the table with it. */
function tickSetup(sinkName?: string, outbox = new FakeOutbox()) {
  const sink = sinkNamed(sinkName);
  const metrics = new Metrics();
  const devices = {
    get: (id: string) =>
      id === 'dc-env-01' ? { id, name: 'Server room 1', zoneCode: 'BLD-DC' } : undefined,
  } as unknown as DevicesService;
  const rules = {
    incidentType: (ruleId: string) => (ruleId === 'indoor-co2' ? 'hvac_fault' : undefined),
  } as unknown as RulesService;
  const config = {
    get: (key: keyof Env) => (key === 'DELIVERY_INTERVAL_MS' ? 1_000 : undefined),
  } as unknown as ConfigService<Env, true>;
  const worker = new DeliveryWorker(
    outbox as unknown as Database,
    devices,
    rules,
    metrics,
    config,
    sink as unknown as AlertSink,
  );
  const deliveries = async (result: string) =>
    (await metrics.deliveries.get()).values.find(
      (v) => (v.labels as Record<string, string>).result === result,
    )?.value ?? 0;
  return { outbox, sink, worker, deliveries };
}

/** Lets pending promise callbacks run, so a test can observe a pass that is waiting on the sink. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('DeliveryWorker.tick', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('delivers an opened event, stores the incident reference and marks the row delivered', async () => {
    const t = tickSetup();
    const row = t.outbox.add();

    await expect(t.worker.tick()).resolves.toBe(1);

    expect(t.sink.opened).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        deviceId: 'dc-env-01',
        deviceName: 'Server room 1',
        zoneCode: 'BLD-DC',
        ruleId: 'indoor-co2',
        incidentType: 'hvac_fault',
        openedValue: 1300,
      }),
    );
    expect(t.outbox.refs.get('1')).toBe('incident-1');
    expect(row).toMatchObject({
      status: 'delivered',
      attempts: 1,
      last_error: null,
      locked_until: null,
    });
    expect(await t.deliveries('delivered')).toBe(1);
  });

  it('falls back to the device id, no zone and equipment_fault for an unknown device and rule', async () => {
    const t = tickSetup();
    t.outbox.add({ device_id: 'gone-01', rule_id: 'retired-rule' });

    await t.worker.tick();

    expect(t.sink.opened).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'gone-01',
        zoneCode: '',
        incidentType: 'equipment_fault',
      }),
    );
  });

  it('passes the stored incident reference to a cleared event', async () => {
    const t = tickSetup();
    t.outbox.refs.set('1', 'incident-9');
    const row = t.outbox.add({ event: 'cleared', cleared_value: 900, cleared_at: new Date() });

    await t.worker.tick();

    expect(t.sink.cleared).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', externalRef: 'incident-9' }),
    );
    expect(t.sink.opened).not.toHaveBeenCalled();
    expect(row.status).toBe('delivered');
  });

  it('lets a cleared event see the reference recorded for the opened one just before it', async () => {
    const t = tickSetup();
    t.outbox.add({ event: 'opened' });
    const cleared = t.outbox.add({ event: 'cleared' });

    await expect(t.worker.tick()).resolves.toBe(2);

    expect(t.sink.cleared).toHaveBeenCalledWith(
      expect.objectContaining({ externalRef: 'incident-1' }),
    );
    expect(cleared.status).toBe('delivered');
  });

  it('marks rows skipped, not delivered, when there is no command center', async () => {
    const t = tickSetup('none');
    const row = t.outbox.add();

    await t.worker.tick();

    expect(row.status).toBe('skipped');
    expect(await t.deliveries('skipped')).toBe(1);
    expect(await t.deliveries('delivered')).toBe(0);
  });

  it('keeps a failing row pending with its error and a short delay, and logs it', async () => {
    const t = tickSetup();
    t.sink.opened.mockRejectedValue(new Error('POST /incidents → 503'));
    const row = t.outbox.add();

    await expect(t.worker.tick()).resolves.toBe(1);

    expect(row).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'POST /incidents → 503',
      locked_until: null,
    });
    // The first backoff step is 2 s with jitter: between 1 s and 2 s.
    expect(row.delay_secs).toBeGreaterThanOrEqual(1);
    expect(row.delay_secs).toBeLessThanOrEqual(2);
    expect(await t.deliveries('retry')).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Delivery ${row.delivery_id}`));
  });

  it('gives up on a row at its last attempt and marks it failed', async () => {
    const t = tickSetup();
    t.sink.opened.mockRejectedValue(new Error('still down'));
    const row = t.outbox.add({ attempts: MAX_ATTEMPTS - 1 });

    await t.worker.tick();

    expect(row).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
    expect(await t.deliveries('failed')).toBe(1);
    expect(await t.deliveries('retry')).toBe(0);
  });

  describe('a cleared event whose opened event has no incident yet', () => {
    /** An `opened` row of alert 1 in the given state, never due, so the pass does not touch it. */
    const siblingOf = (t: ReturnType<typeof tickSetup>, status: OutboxRow['status']) =>
      t.outbox.add({ event: 'opened', status, next_attempt: Number.MAX_SAFE_INTEGER });

    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z') }));

    it('waits without using an attempt, counts it as waiting and logs no warning', async () => {
      const t = tickSetup();
      t.sink.cleared.mockRejectedValue(new RetryLater('incident not created yet'));
      siblingOf(t, 'pending');
      const row = t.outbox.add({ event: 'cleared', attempts: 3 });

      await t.worker.tick();

      expect(row).toMatchObject({
        status: 'pending',
        attempts: 3,
        last_error: 'incident not created yet',
        locked_until: null,
        delay_secs: WAITING_RETRY_MS / 1000,
      });
      expect(row.next_attempt).toBe(Date.now() + WAITING_RETRY_MS);
      expect(await t.deliveries('waiting')).toBe(1);
      expect(await t.deliveries('retry')).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    });

    it('never fails just by waiting, however long the opened event takes', async () => {
      const t = tickSetup();
      t.sink.cleared.mockRejectedValue(new RetryLater('incident not created yet'));
      siblingOf(t, 'pending');
      const row = t.outbox.add({ event: 'cleared' });

      for (let pass = 0; pass < MAX_ATTEMPTS * 2; pass++) {
        await t.worker.tick();
        jest.setSystemTime(Date.now() + WAITING_RETRY_MS);
      }

      expect(row).toMatchObject({ status: 'pending', attempts: 0 });
      expect(await t.deliveries('waiting')).toBe(MAX_ATTEMPTS * 2);
      expect(await t.deliveries('failed')).toBe(0);
    });

    it('goes through once the opened event has its incident', async () => {
      const t = tickSetup();
      t.sink.cleared.mockRejectedValueOnce(new RetryLater('incident not created yet'));
      const opened = siblingOf(t, 'pending');
      const row = t.outbox.add({ event: 'cleared' });
      await t.worker.tick();
      expect(row.status).toBe('pending');

      Object.assign(opened, { status: 'delivered' });
      t.outbox.refs.set('1', 'incident-1');
      jest.setSystemTime(Date.now() + WAITING_RETRY_MS);
      await t.worker.tick();

      expect(t.sink.cleared).toHaveBeenLastCalledWith(
        expect.objectContaining({ externalRef: 'incident-1' }),
      );
      expect(row).toMatchObject({ status: 'delivered', attempts: 1 });
    });

    it.each([
      ['failed', 'failed', 'opened event failed: no incident to resolve'],
      ['skipped', 'skipped', 'opened event skipped: no incident to resolve'],
      ['delivered', 'failed', 'opened event is delivered but the alert has no incident reference'],
    ] as const)(
      'is settled at once when the opened event is %s: it will never have an incident',
      async (opened, settled, reason) => {
        const t = tickSetup();
        t.sink.cleared.mockRejectedValue(new RetryLater('incident not created yet'));
        siblingOf(t, opened);
        const row = t.outbox.add({ event: 'cleared', attempts: 2 });

        await expect(t.worker.tick()).resolves.toBe(1);

        expect(row).toMatchObject({ status: settled, attempts: 2, last_error: reason });
        expect(await t.deliveries(settled)).toBe(1);
        expect(await t.deliveries('waiting')).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`settled as ${settled}`));
      },
    );

    it('is settled as failed when there is no opened event at all', async () => {
      const t = tickSetup();
      t.sink.cleared.mockRejectedValue(new RetryLater('incident not created yet'));
      const row = t.outbox.add({ event: 'cleared' });

      await t.worker.tick();

      expect(row).toMatchObject({
        status: 'failed',
        last_error: 'opened event is missing but the alert has no incident reference',
      });
    });

    it('still counts a real failure of the sink as an attempt', async () => {
      const t = tickSetup();
      t.sink.cleared.mockRejectedValue(new Error('POST /incidents/incident-1/resolve → 503'));
      t.outbox.refs.set('1', 'incident-1');
      const row = t.outbox.add({ event: 'cleared' });

      await t.worker.tick();

      expect(row).toMatchObject({ status: 'pending', attempts: 1 });
      expect(await t.deliveries('retry')).toBe(1);
      expect(await t.deliveries('waiting')).toBe(0);
    });
  });

  it('logs a failed pass, resolves to 0 and still runs the next one', async () => {
    const t = tickSetup();
    const row = t.outbox.add();
    t.outbox.failure = new Error('connect ECONNREFUSED');

    await expect(t.worker.tick()).resolves.toBe(0);

    expect(error).toHaveBeenCalledWith(expect.stringContaining('Delivery pass failed:'));
    expect(row.status).toBe('pending');

    t.outbox.failure = undefined;
    await expect(t.worker.tick()).resolves.toBe(1);
    expect(row.status).toBe('delivered');
  });

  it('never runs two passes at once', async () => {
    const t = tickSetup();
    t.outbox.add();
    t.outbox.add({ alert_id: '2' });
    let calling = 0;
    let most = 0;
    t.sink.opened.mockImplementation(async () => {
      most = Math.max(most, ++calling);
      await settle();
      calling--;
      return 'incident-1';
    });

    await expect(Promise.all([t.worker.tick(), t.worker.tick()])).resolves.toEqual([2, 0]);

    expect(most).toBe(1);
    expect(t.sink.opened).toHaveBeenCalledTimes(2);
  });

  it('waits for the pass in flight before shutdown completes', async () => {
    const t = tickSetup();
    let finish!: (reference: string) => void;
    t.sink.opened.mockImplementation(() => new Promise<string>((resolve) => (finish = resolve)));
    const row = t.outbox.add();
    const pass = t.worker.tick();
    await settle();
    expect(t.sink.opened).toHaveBeenCalledTimes(1);

    let down = false;
    const shutdown = t.worker.beforeApplicationShutdown().then(() => (down = true));
    await settle();
    expect(down).toBe(false);

    finish('incident-1');
    await shutdown;
    await pass;
    expect(down).toBe(true);
    expect(row.status).toBe('delivered');
  });

  it('finishes the row in flight at shutdown and takes no other', async () => {
    const t = tickSetup();
    let finish!: (reference: string) => void;
    t.sink.opened.mockImplementationOnce(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    const rows = ['1', '2', '3'].map((alert_id) => t.outbox.add({ alert_id }));
    const pass = t.worker.tick();
    await settle();
    expect(t.sink.opened).toHaveBeenCalledTimes(1);

    const shutdown = t.worker.beforeApplicationShutdown();
    finish('incident-1');
    await shutdown;

    await expect(pass).resolves.toBe(1);
    expect(t.sink.opened).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ status: 'delivered', attempts: 1 });
    // Not taken, so not leased: another replica can deliver them at once.
    expect(rows.slice(1).map((r) => [r.status, r.locked_until])).toEqual([
      ['pending', null],
      ['pending', null],
    ]);
    await expect(t.worker.tick()).resolves.toBe(0);
  });

  describe('lease', () => {
    it('holds no transaction while the command center is being called', async () => {
      const t = tickSetup();
      let during = -1;
      t.sink.opened.mockImplementation(async () => {
        during = t.outbox.active;
        await settle();
        return 'incident-1';
      });
      const row = t.outbox.add();

      await t.worker.tick();

      expect(during).toBe(0);
      expect(row.status).toBe('delivered');
    });

    it('leases the row it is delivering, for LEASE_MS', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z') });
      const t = tickSetup();
      let leasedUntil: number | null = null;
      const row = t.outbox.add();
      t.sink.opened.mockImplementation(async () => {
        leasedUntil = row.locked_until;
        return 'incident-1';
      });

      await t.worker.tick();

      expect(leasedUntil).toBe(Date.now() + LEASE_MS);
    });

    it('gives each row to one of two workers, never to both', async () => {
      const first = tickSetup();
      const second = tickSetup(undefined, first.outbox);
      const rows = [1, 2, 3].map((n) => first.outbox.add({ alert_id: String(n) }));
      // Slow enough for the two passes to overlap.
      for (const t of [first, second]) {
        t.sink.opened.mockImplementation(async () => {
          await settle();
          return 'incident-1';
        });
      }

      const handled = await Promise.all([first.worker.tick(), second.worker.tick()]);

      expect(handled[0] + handled[1]).toBe(3);
      expect(first.sink.opened.mock.calls.length + second.sink.opened.mock.calls.length).toBe(3);
      expect(rows.map((r) => [r.status, r.attempts])).toEqual([
        ['delivered', 1],
        ['delivered', 1],
        ['delivered', 1],
      ]);
    });

    it('skips a row whose lease has not run out, and takes it once it has', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z') });
      const t = tickSetup();
      const row = t.outbox.add({ locked_until: Date.now() + 30_000 });

      await expect(t.worker.tick()).resolves.toBe(0);
      expect(row.status).toBe('pending');

      jest.setSystemTime(Date.now() + 30_000);
      await expect(t.worker.tick()).resolves.toBe(1);
      expect(row.status).toBe('delivered');
    });

    it('leaves a late result alone when the row was finished by another worker meanwhile', async () => {
      const t = tickSetup();
      const row = t.outbox.add();
      t.sink.opened.mockImplementation(async () => {
        // Its lease ran out and another worker delivered it while this call was slow.
        Object.assign(row, { status: 'delivered', attempts: 1, locked_until: null });
        return 'incident-1';
      });

      await t.worker.tick();

      expect(row).toMatchObject({ status: 'delivered', attempts: 1 });
      expect(await t.deliveries('delivered')).toBe(0);
    });

    it('keeps a delivered row leased and counts nothing when the result cannot be recorded', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-17T10:00:00Z') });
      const t = tickSetup();
      const row = t.outbox.add();
      t.outbox.transactionFailure = new Error('connection terminated unexpectedly');

      await expect(t.worker.tick()).resolves.toBe(1);

      expect(t.sink.opened).toHaveBeenCalledTimes(1);
      expect(row).toMatchObject({ status: 'pending', attempts: 0 });
      expect(row.locked_until).toBe(Date.now() + LEASE_MS);
      expect(await t.deliveries('delivered')).toBe(0);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('could not be recorded'));

      // Nobody takes it while the lease runs; afterwards it is delivered again, with no attempt lost.
      t.outbox.transactionFailure = undefined;
      await expect(t.worker.tick()).resolves.toBe(0);
      jest.setSystemTime(Date.now() + LEASE_MS);
      await expect(t.worker.tick()).resolves.toBe(1);
      expect(row).toMatchObject({ status: 'delivered', attempts: 1 });
    });
  });
});

import { Logger } from '@nestjs/common';
import { telemetryTopic } from '@itp/telemetry-contract';
import { connectAsync, type MqttClient } from 'mqtt';
import { Pool } from 'pg';
import request from 'supertest';
import { RECONCILE_INTERVAL_MS } from '../src/rules/rules.service';
import type { Reading } from '../src/telemetry/rollup';
import { fakeCommandCenter } from './support/fake-command-center';
import { counterValue } from './support/metrics';
import { startReplica, type Replica } from './support/replica';
import { resetTestDatabase } from './support/test-database';
import { until } from './support/wait';

/**
 * Two replicas of the real service on one MQTT shared-subscription group, one PostgreSQL and one
 * fake command center: what ADR-0001, ADR-0004 and ADR-0005 claim about several processes.
 *
 * Each case uses a device of its own, so cases stay independent of each other:
 *   lha-air-01    messages are split over the replicas        (IMP-07.2)
 *   dc-env-01     one alert opened once, one outbox row once  (IMP-07.3)
 *   dc-env-02     state of a replica that left                (IMP-08.1)
 *   stu-air-01    rollup upserts in a fixed order             (IMP-09.1)
 *   hub-power-01, lib-air-01   a slow command center          (IMP-10.1)
 */

// Environment is set in e2e-env.js, before AppModule is loaded.
const DATABASE_URL = process.env.DATABASE_URL!;
const MQTT_URL = process.env.MQTT_URL!;

describe('Telemetry pipeline with two replicas (e2e)', () => {
  let db: Pool;
  let publisher: MqttClient;
  let occ: Awaited<ReturnType<typeof fakeCommandCenter>>;
  let a: Replica;
  let b: Replica;

  const t0 = Date.now() - 60_000;
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const accepted = (replica: Replica) =>
    counterValue(replica.metrics, 'messages', { result: 'accepted' });
  const count = async (sql: string) => Number((await db.query(sql)).rows[0].count);

  beforeAll(async () => {
    db = new Pool({ connectionString: DATABASE_URL });
    await resetTestDatabase(db);
    occ = await fakeCommandCenter();

    a = await startReplica('a');
    b = await startReplica('b');
    await until(async () => a.consumer.isConnected && b.consumer.isConnected, Boolean);
    await new Promise((r) => setTimeout(r, 200)); // let the SUBACKs land

    publisher = await connectAsync(MQTT_URL, {
      protocolVersion: 5,
      clientId: `e2e-replicas-publisher-${process.pid}`,
    });
  });

  // A case that holds the command center's responses must not leave them held for the next one.
  afterEach(() => occ?.setDelay(undefined));

  afterAll(async () => {
    await publisher?.endAsync();
    await a?.stop();
    await b?.stop();
    await db?.end();
    await occ?.close();
  });

  it('spreads the messages of one device over both replicas', async () => {
    const topic = telemetryTopic({ zoneCode: 'BLD-LHA', deviceId: 'lha-air-01' });
    const messages = 40;
    for (let seq = 1; seq <= messages; seq++) {
      await publisher.publishAsync(
        topic,
        JSON.stringify({ seq, ts: at(seq), metrics: { co2_ppm: 600, temperature_c: 21 } }),
        { qos: 1 },
      );
    }
    await until(
      async () => (await accepted(a)) + (await accepted(b)),
      (n) => n >= messages,
    );
    // One after the other: two flushes at once would also test the rollup lock order (IMP-09).
    await a.writer.flush();
    await b.writer.flush();

    expect(a.consumer.isConnected).toBe(true);
    expect(b.consumer.isConnected).toBe(true);
    const [onA, onB] = [await accepted(a), await accepted(b)];
    expect(onA).toBeGreaterThan(0);
    expect(onB).toBeGreaterThan(0);
    expect(onA + onB).toBe(messages);
    expect(await count(`SELECT count(*) FROM reading WHERE device_id = 'lha-air-01'`)).toBe(
      messages * 2,
    );
    for (const replica of [a, b]) {
      expect(await counterValue(replica.metrics, 'readings', { result: 'duplicate' })).toBe(0);
    }
  });

  // The next two cases belong together: the second delivers the alerts the first opened.
  it('opens one alert per rule however many replicas see the breaches', async () => {
    const topic = telemetryTopic({ zoneCode: 'BLD-DC', deviceId: 'dc-env-01' });
    const before = (await accepted(a)) + (await accepted(b));
    const messages = 12;
    for (let seq = 1; seq <= messages; seq++) {
      await publisher.publishAsync(
        topic,
        // Above the raise thresholds of server-room-hot (27) and server-room-humid (60).
        JSON.stringify({ seq, ts: at(seq), metrics: { temperature_c: 29, humidity_pct: 65 } }),
        { qos: 1 },
      );
    }
    await until(
      async () => (await accepted(a)) + (await accepted(b)) - before,
      (n) => n >= messages,
    );
    await a.writer.flush();
    await b.writer.flush();
    // Counted by polling: the writers' own timers can flush at the same moment as the calls above.
    await until(
      () => count('SELECT count(*) FROM alert'),
      (n) => n >= 2,
      10_000,
    );

    const { rows } = await db.query(`SELECT rule_id, status FROM alert ORDER BY rule_id`);
    expect(rows).toEqual([
      { rule_id: 'server-room-hot', status: 'open' },
      { rule_id: 'server-room-humid', status: 'open' },
    ]);
    expect(await count(`SELECT count(*) FROM alert_delivery`)).toBe(2);
    expect(await count(`SELECT count(*) FROM alert_delivery WHERE event = 'opened'`)).toBe(2);
    // Whichever replica lost a race writes no outbox row and counts no transition.
    const opened = (replica: Replica) =>
      counterValue(replica.metrics, 'alertTransitions', { transition: 'opened' });
    expect((await opened(a)) + (await opened(b))).toBe(2);
  });

  it('delivers each outbox row once when both replicas poll at the same time', async () => {
    // Slow responses keep each pass busy long enough for the other replica's pass to overlap it.
    occ.setDelay((call) => (call.url === '/api/incidents' ? 300 : 0));
    const timed = async (replica: Replica) => {
      const start = Date.now();
      const handled = await replica.delivery.tick();
      return { handled, start, end: Date.now() };
    };

    const [x, y] = await Promise.all([timed(a), timed(b)]);
    occ.setDelay(undefined);

    // Today's pass may take both rows and leave the other replica none; the sum is the invariant.
    expect(x.handled + y.handled).toBe(2);
    expect(Math.max(x.start, y.start)).toBeLessThan(Math.min(x.end, y.end)); // the passes overlapped
    const creates = occ.calls.filter((c) => c.method === 'POST' && c.url === '/api/incidents');
    expect(creates).toHaveLength(2);
    expect(new Set(creates.map((c) => c.headers['idempotency-key'])).size).toBe(2);
    const { rows } = await db.query(`SELECT status, attempts FROM alert_delivery ORDER BY id`);
    expect(rows).toEqual([
      { status: 'delivered', attempts: 1 },
      { status: 'delivered', attempts: 1 },
    ]);
  });

  it('does not deadlock when both replicas upsert the same rollup rows in opposite orders', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      // 300 minutes of the last few hours: every flush upserts the same 300 rollup rows. One
      // replica holds them newest first and the other oldest first, at different seconds so no
      // reading collides on the primary key and only the rollup rows are shared.
      const minutes = 300;
      const first = Math.floor(Date.now() / 60_000) * 60_000 - minutes * 60_000;
      const buffered = (order: number[], second: number): Reading[] =>
        order.map((m) => ({
          deviceId: 'stu-air-01',
          metric: 'temperature_c',
          ts: new Date(first + m * 60_000 + second * 1000),
          value: 22,
        }));
      const ascending = Array.from({ length: minutes }, (_, m) => m);
      const descending = [...ascending].reverse();
      const deadlocks = () =>
        warn.mock.calls.filter(([message]) => String(message).includes('deadlock detected'));

      for (let round = 0; round < 20 && deadlocks().length === 0; round++) {
        a.writer.add(buffered(descending, 2 * round + 1));
        b.writer.add(buffered(ascending, 2 * round + 2));
        await Promise.all([a.writer.flush(), b.writer.flush()]);
      }

      expect(deadlocks()).toHaveLength(0);
      expect(await counterValue(a.metrics, 'flushRetries')).toBe(0);
      expect(await counterValue(b.metrics, 'flushRetries')).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('clears an alert while the delivery pass is still waiting on a slow command center', async () => {
    const power = telemetryTopic({ zoneCode: 'BLD-HUB', deviceId: 'hub-power-01' });
    const air = telemetryTopic({ zoneCode: 'BLD-LIB', deviceId: 'lib-air-01' });
    const total = async () => (await accepted(a)) + (await accepted(b));
    const send = async (topic: string, seqs: number[], metrics: Record<string, number>) => {
      const before = await total();
      for (const seq of seqs) {
        await publisher.publishAsync(topic, JSON.stringify({ seq, ts: at(seq), metrics }), {
          qos: 1,
        });
      }
      await until(total, (t) => t >= before + seqs.length);
      await Promise.all([a.writer.flush(), b.writer.flush()]);
    };
    const openAlerts = () => count(`SELECT count(*) FROM alert WHERE status = 'open'`);
    const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

    // Two alerts, the power one first, so its outbox row comes first: power-over-contract opens
    // after 2 breaches above 180 kW, indoor-co2 after 3 above 1200 ppm.
    const alertsBefore = await openAlerts();
    await send(power, range(1, 8), { power_kw: 200 });
    await until(openAlerts, (n) => n >= alertsBefore + 1);
    await send(air, range(1, 12), { co2_ppm: 1300 });
    await until(openAlerts, (n) => n >= alertsBefore + 2);

    // The command center answers the power incident at once and holds the air one for 3 s.
    occ.setDelay((call) => {
      const zone = (call.body as { zoneId?: string } | null)?.zoneId;
      return call.method === 'POST' && call.url === '/api/incidents' && zone === 'zone-lib'
        ? 3000
        : 0;
    });
    const incidents = () =>
      occ.calls.filter((c) => c.method === 'POST' && c.url === '/api/incidents');
    const before = incidents().length;
    let finished = false;
    const pass = a.delivery.tick().then((handled) => {
      finished = true;
      return handled;
    });
    // The second incident has arrived: the power row is done and the pass is inside the slow call.
    await until(
      async () => incidents().length,
      (n) => n >= before + 2,
    );

    // The power alert returns to normal. Its clear must not wait for the pass to end.
    const started = Date.now();
    await send(power, range(100, 8), { power_kw: 100 });
    const cleared = await until(
      async () =>
        (await db.query(`SELECT status FROM alert WHERE device_id = 'hub-power-01'`)).rows[0]
          ?.status as string,
      (status) => status === 'cleared',
    );
    const elapsed = Date.now() - started;

    expect(cleared).toBe('cleared');
    expect(finished).toBe(false); // the pass was still waiting when the alert cleared
    expect(elapsed).toBeLessThan(1500); // the slow call takes 3 s
    // Both opened events, and the cleared event of the power alert, which the pass picks up as soon
    // as it exists: rows are taken one at a time, not listed when the pass starts.
    await expect(pass).resolves.toBe(3);
    expect(
      occ.calls.some((c) => c.method === 'POST' && c.url === '/api/incidents/incident-1/resolve'),
    ).toBe(true);
  });

  it('pages through every alert, newest first, one at a time, without skipping a tie', async () => {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id::text AS id FROM alert ORDER BY opened_at DESC, id DESC',
    );
    const expected = rows.map((r) => r.id);
    expect(expected.length).toBeGreaterThanOrEqual(3);
    // The hot and humid rules of dc-env-01 open on the same message, so two alerts share an
    // instant: the id in the cursor is what keeps the second of them from being skipped.
    expect(
      await count(
        'SELECT count(*) FROM (SELECT opened_at FROM alert GROUP BY opened_at HAVING count(*) > 1) t',
      ),
    ).toBeGreaterThanOrEqual(1);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page <= expected.length; page++) {
      const res = await request(a.app.getHttpServer())
        .get('/api/alerts')
        .query({ limit: 1, ...(cursor ? { before: cursor } : {}) })
        .expect(200);
      seen.push(...res.body.map((alert: { id: string }) => alert.id));
      cursor = res.headers['x-next-cursor'];
      if (!cursor) break;
    }

    expect(cursor).toBeUndefined();
    expect(seen).toEqual(expected);
  });

  // This case stops a replica: keep it the last one in the file.
  it('lets the surviving replica clear an alert opened by the replica that left', async () => {
    const topic = telemetryTopic({ zoneCode: 'BLD-DC', deviceId: 'dc-env-02' });
    let seq = 0;
    const total = async () => (await accepted(a)) + (await accepted(b));
    const send = async (temperature_c: number, n = 1) => {
      const before = await total();
      for (let i = 0; i < n; i++) {
        await publisher.publishAsync(
          topic,
          JSON.stringify({ seq: ++seq, ts: at(seq), metrics: { temperature_c } }),
          { qos: 1 },
        );
      }
      await until(total, (t) => t >= before + n);
      await a.writer.flush();
      await b.writer.flush();
    };
    const opened = (replica: Replica) =>
      counterValue(replica.metrics, 'alertTransitions', { transition: 'opened' });

    // Both replicas see the device while it is fine, so both cache its rule as closed.
    await send(22, 12);

    // Breach one message at a time and stop at the first replica that opens the alert: the other
    // has fewer than three breaches and still caches the rule as closed.
    const baseline = { a: await opened(a), b: await opened(b) };
    let opener: Replica | undefined;
    for (let i = 0; i < 12 && !opener; i++) {
      await send(29);
      if ((await opened(a)) > baseline.a) opener = a;
      else if ((await opened(b)) > baseline.b) opener = b;
    }
    expect(opener).toBeDefined();
    const survivor = opener === a ? b : a;
    await opener!.stop();

    // The device is fine again and only the survivor hears it. The clock moves by the time a
    // replica trusts its cache (the e2e timeout is shorter than that time).
    const realNow = Date.now;
    const clock = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => realNow() + RECONCILE_INTERVAL_MS);
    try {
      const before = await accepted(survivor);
      for (let i = 0; i < 6; i++) {
        await publisher.publishAsync(
          topic,
          JSON.stringify({ seq: ++seq, ts: at(seq), metrics: { temperature_c: 22 } }),
          { qos: 1 },
        );
      }
      await until(
        () => accepted(survivor),
        (n) => n >= before + 6,
      );
      await survivor.writer.flush();
      const status = await until(
        async () =>
          (await db.query(`SELECT status FROM alert WHERE device_id = 'dc-env-02'`)).rows[0]
            ?.status as string,
        (value) => value === 'cleared',
      );

      expect(status).toBe('cleared');
    } finally {
      clock.mockRestore();
    }
  });
});

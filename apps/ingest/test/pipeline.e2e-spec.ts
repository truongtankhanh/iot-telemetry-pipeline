import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { telemetryTopic } from '@itp/telemetry-contract';
import { connectAsync, type MqttClient } from 'mqtt';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { DeliveryWorker } from '../src/delivery/delivery.worker';
import { Metrics } from '../src/metrics/metrics';
import { BatchWriter } from '../src/telemetry/batch-writer.service';
import { MqttConsumer } from '../src/telemetry/mqtt-consumer.service';

/**
 * The real service against a real PostgreSQL (`DATABASE_URL`) and a real MQTT broker (`MQTT_URL`),
 * with a stand-in for ops-command-center that records the calls it receives.
 */

// Environment is set in e2e-env.js, before AppModule is loaded.
const DATABASE_URL = process.env.DATABASE_URL!;
const MQTT_URL = process.env.MQTT_URL!;
const FAKE_OCC_PORT = 3199;

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

function fakeCommandCenter(): Promise<{ server: Server; calls: Call[] }> {
  const calls: Call[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({ method: req.method!, url: req.url!, body: raw ? JSON.parse(raw) : null });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/zones')
      return res.end(JSON.stringify([{ id: 'zone-dc', code: 'BLD-DC' }]));
    if (req.url === '/api/incidents')
      return res.writeHead(201).end(JSON.stringify({ id: 'incident-1' }));
    return res.end('{}');
  });
  return new Promise((resolve) => server.listen(FAKE_OCC_PORT, () => resolve({ server, calls })));
}

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 5000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('Telemetry pipeline (e2e)', () => {
  let app: INestApplication;
  let db: Pool;
  let publisher: MqttClient;
  let occ: Awaited<ReturnType<typeof fakeCommandCenter>>;
  let metrics: Metrics;
  let writer: BatchWriter;

  const topic = telemetryTopic({ zoneCode: 'BLD-DC', deviceId: 'dc-env-01' });
  const t0 = Date.now() - 60_000;
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const publish = (seq: number, ts: string, metrics: Record<string, number>, t = topic) =>
    publisher.publishAsync(t, JSON.stringify({ seq, ts, metrics }), { qos: 1 });
  const counter = async (name: keyof Metrics, labels: Record<string, string> = {}) => {
    const metric = await (
      metrics[name] as { get(): Promise<{ values: { labels: object; value: number }[] }> }
    ).get();
    return metric.values
      .filter((v) =>
        Object.entries(labels).every(([k, l]) => (v.labels as Record<string, string>)[k] === l),
      )
      .reduce((sum, v) => sum + v.value, 0);
  };
  const received = () => counter('messages');
  const count = async (sql: string) => Number((await db.query(sql)).rows[0].count);

  beforeAll(async () => {
    db = new Pool({ connectionString: DATABASE_URL });
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    occ = await fakeCommandCenter();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0);
    metrics = app.get(Metrics);
    writer = app.get(BatchWriter);
    await until(async () => app.get(MqttConsumer).isConnected, Boolean);
    await new Promise((r) => setTimeout(r, 200)); // let the SUBACK land

    publisher = await connectAsync(MQTT_URL, {
      protocolVersion: 5,
      clientId: `e2e-publisher-${process.pid}`,
    });
  });

  afterAll(async () => {
    await publisher?.endAsync();
    await app?.close();
    await db?.end();
    occ?.server.close();
  });

  it('creates the schema and the daily partitions on boot', async () => {
    expect(
      await count(
        `SELECT count(*) FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'reading'`,
      ),
    ).toBe(5);
    expect(await count('SELECT count(*) FROM device')).toBe(6);
  });

  it('stores readings, ignores duplicates and rolls up only what was stored', async () => {
    await publish(1, at(0), { temperature_c: 28.1, humidity_pct: 44 });
    await publish(2, at(5), { temperature_c: 28.4, humidity_pct: 44 });
    await publish(3, at(10), { temperature_c: 28.9, humidity_pct: 45 });
    await publish(3, at(10), { temperature_c: 28.9, humidity_pct: 45 }); // redelivery
    await until(received, (n) => n >= 4);
    await writer.flush();

    expect(await count(`SELECT count(*) FROM reading WHERE device_id = 'dc-env-01'`)).toBe(6);
    expect(await counter('readings', { result: 'duplicate' })).toBe(2);
    const { rows } = await db.query(
      `SELECT sum(count)::int AS n, max(max) AS hottest FROM rollup_1m WHERE device_id = 'dc-env-01' AND metric = 'temperature_c'`,
    );
    expect(rows[0]).toEqual({ n: 3, hottest: 28.9 });
  });

  it('rejects malformed and unknown messages, counted by reason', async () => {
    await publisher.publishAsync(topic, '{"seq":1', { qos: 1 });
    await publish(
      1,
      at(1),
      { temperature_c: 22 },
      telemetryTopic({ zoneCode: 'BLD-DC', deviceId: 'ghost-01' }),
    );
    await publish(
      1,
      at(1),
      { temperature_c: 22 },
      telemetryTopic({ zoneCode: 'BLD-LIB', deviceId: 'dc-env-01' }),
    );
    await publish(4, at(12), { co2_ppm: 800 });
    await until(
      () => counter('messages', { result: 'rejected' }),
      (n) => n >= 4,
    );

    expect(await counter('rejections', { reason: 'json' })).toBe(1);
    expect(await counter('rejections', { reason: 'unknown_device' })).toBe(1);
    expect(await counter('rejections', { reason: 'zone_mismatch' })).toBe(1);
    expect(await counter('rejections', { reason: 'metric_not_registered' })).toBe(1);
  });

  it('opens an alert after three breaches and delivers it as an incident', async () => {
    const { rows } = await db.query(`SELECT rule_id, status, opened_value FROM alert`);
    expect(rows).toEqual([{ rule_id: 'server-room-hot', status: 'open', opened_value: 28.9 }]);

    expect(await app.get(DeliveryWorker).tick()).toBe(1);
    const create = occ.calls.find((c) => c.method === 'POST' && c.url === '/api/incidents');
    expect(create?.body).toMatchObject({
      type: 'equipment_fault',
      severity: 'high',
      title: 'Server room temperature high',
      zoneId: 'zone-dc',
    });
    const alert = await db.query(`SELECT external_ref FROM alert`);
    expect(alert.rows[0].external_ref).toBe('incident-1');
  });

  it('clears the alert below the clear threshold and resolves the incident', async () => {
    await publish(5, at(20), { temperature_c: 26.0, humidity_pct: 45 }); // inside the band: stays open
    await publish(6, at(25), { temperature_c: 25.1, humidity_pct: 45 }); // below 25.5: clears
    await until(received, (n) => n >= 10);
    await writer.flush();

    const { rows } = await db.query(`SELECT status, cleared_value FROM alert`);
    expect(rows).toEqual([{ status: 'cleared', cleared_value: 25.1 }]);
    await app.get(DeliveryWorker).tick();
    expect(occ.calls.at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/incidents/incident-1/resolve',
    });

    const api = await request(app.getHttpServer()).get('/api/alerts').expect(200);
    expect(api.body[0]).toMatchObject({
      status: 'cleared',
      externalRef: 'incident-1',
      deliveryStatus: 'delivered',
    });
  });

  it('measures gaps from sequence numbers', async () => {
    await publish(10, at(30), { temperature_c: 23, humidity_pct: 45 }); // 7, 8, 9 missing
    await until(received, (n) => n >= 11);
    expect(await counter('sequenceGaps')).toBe(3);
  });

  it('serves raw readings and per-minute rollups over HTTP', async () => {
    await writer.flush();
    const raw = await request(app.getHttpServer())
      .get(
        `/api/devices/dc-env-01/readings?metric=temperature_c&resolution=raw&from=${at(-5)}&to=${at(60)}`,
      )
      .expect(200);
    expect(raw.body.points.map((p: { value: number }) => p.value)).toEqual([
      28.1, 28.4, 28.9, 26, 25.1, 23,
    ]);

    const metricsText = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(metricsText.text).toContain('telemetry_readings_total{result="stored"} 12');
  });

  it('drains buffered readings on shutdown instead of dropping them', async () => {
    await publish(11, at(35), { temperature_c: 23.3, humidity_pct: 45 });
    await until(received, (n) => n >= 12);
    expect(await count(`SELECT count(*) FROM reading WHERE ts = '${at(35)}'`)).toBe(0); // still buffered

    await app.close();
    app = undefined as unknown as INestApplication;
    expect(await count(`SELECT count(*) FROM reading WHERE ts = '${at(35)}'`)).toBe(2);
  });
});

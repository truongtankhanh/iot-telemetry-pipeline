import { telemetryTopic } from '@itp/telemetry-contract';
import { connectAsync } from 'mqtt';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { parseArgs } from 'node:util';
import pg from 'pg';
import type { DeviceSpec } from './signals.ts';

/**
 * End-to-end throughput: publishes N messages as fast as the broker accepts them, then waits until
 * every reading is in PostgreSQL. Measures the whole path — broker, ingest, batch writes, rollups,
 * rule evaluation — not just publishing.
 */

const { values } = parseArgs({
  options: {
    broker: { type: 'string', default: process.env.MQTT_URL ?? 'mqtt://localhost:1883' },
    database: {
      type: 'string',
      default: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/telemetry',
    },
    registry: {
      type: 'string',
      default: new URL('../../ingest/config/devices.json', import.meta.url).pathname,
    },
    messages: { type: 'string', default: '50000' },
    timeout: { type: 'string', default: '120' },
  },
});

const total = Number(values.messages);
const devices = (JSON.parse(readFileSync(values.registry, 'utf8')) as { devices: DeviceSpec[] })
  .devices;
const db = new pg.Pool({ connectionString: values.database });
const client = await connectAsync(values.broker, {
  protocolVersion: 5,
  clientId: `bench-${process.pid}`,
});

// Distinct timestamps inside the accepted window.
const base = Date.now() - 60 * 60_000;
const expected = Array.from(
  { length: total },
  (_, i) => devices[i % devices.length]!.metrics.length,
).reduce((a, b) => a + b, 0);
// Count by arrival time (database clock), so earlier runs never leak into this one's numbers.
const runStart = (await db.query<{ now: Date }>('SELECT now()')).rows[0]!.now;
const countStored = async () =>
  Number(
    (await db.query(`SELECT count(*) FROM reading WHERE received_at >= $1`, [runStart])).rows[0]
      .count,
  );

const before = await countStored();
console.log(`Publishing ${total} messages (${expected} readings) from ${devices.length} devices…`);

const started = performance.now();
const seq = new Map<string, number>();
const inFlight: Promise<unknown>[] = [];
for (let i = 0; i < total; i++) {
  const device = devices[i % devices.length]!;
  const next = (seq.get(device.id) ?? 1_000_000) + 1;
  seq.set(device.id, next);
  const metrics = Object.fromEntries(device.metrics.map((m) => [m, 20 + (i % 10)]));
  const payload = JSON.stringify({ seq: next, ts: new Date(base + i * 10).toISOString(), metrics });
  inFlight.push(
    client.publishAsync(
      telemetryTopic({ zoneCode: device.zoneCode, deviceId: device.id }),
      payload,
      { qos: 1 },
    ),
  );
  if (inFlight.length >= 500) await Promise.all(inFlight.splice(0));
}
await Promise.all(inFlight);
const published = performance.now();

let stored = before;
const deadline = Date.now() + Number(values.timeout) * 1000;
while (stored - before < expected && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 100));
  stored = await countStored();
}
const persisted = performance.now();
await client.endAsync();
await db.end();

const seconds = (ms: number) => (ms / 1000).toFixed(2);
const rate = (n: number, ms: number) => Math.round(n / (ms / 1000)).toLocaleString('en-US');
console.table({
  'messages published': total,
  'readings expected': expected,
  'readings stored': stored - before,
  'publish time (s)': seconds(published - started),
  'end-to-end time (s)': seconds(persisted - started),
  'messages/s end-to-end': rate(total, persisted - started),
  'readings/s end-to-end': rate(stored - before, persisted - started),
  machine: `${cpus().length} vCPU, Node ${process.versions.node}`,
});
process.exit(stored - before === expected ? 0 : 1);

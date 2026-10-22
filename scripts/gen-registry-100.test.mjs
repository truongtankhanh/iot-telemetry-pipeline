import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildRegistry,
  FIXTURE_DIR,
  INGEST_CONFIG,
  renderFiles,
  ZONE_TABLE,
} from './gen-registry-100.mjs';

const originals = JSON.parse(readFileSync(new URL('devices.json', INGEST_CONFIG), 'utf8')).devices;
const { devices } = buildRegistry(originals);

const count = (items, key) => {
  const counts = new Map();
  for (const item of items) counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
  return counts;
};

// The rules of ingest's `parseDevices` and the id pattern of docs/configuration.md.
test('it makes 100 devices with unique ids that ingest accepts, in 20 zones', () => {
  assert.equal(devices.length, 100);
  assert.equal(new Set(devices.map((d) => d.id)).size, 100);
  for (const d of devices) {
    assert.match(d.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, d.id);
    assert.match(d.zoneCode, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, d.zoneCode);
    for (const key of ['kind', 'name']) assert.ok(d[key], `${d.id}.${key}`);
    assert.ok(d.metrics.length > 0, d.id);
    for (const metric of d.metrics) {
      assert.ok(['temperature_c', 'humidity_pct', 'co2_ppm', 'power_kw'].includes(metric), metric);
    }
  }
  assert.equal(new Set(devices.map((d) => d.zoneCode)).size, 20);
  assert.equal(ZONE_TABLE.length, 20);
});

test('it keeps the devices of ingest first and exactly as they are', () => {
  assert.deepEqual(devices.slice(0, originals.length), originals);
});

test('the first eight zones have the sizes of frame 19, and every zone has the size of its table row', () => {
  const sizes = count(devices, 'zoneCode');
  assert.deepEqual(
    ZONE_TABLE.slice(0, 8).map((z) => sizes.get(z.code)),
    [14, 9, 6, 6, 8, 7, 8, 5],
  );
  for (const zone of ZONE_TABLE) {
    const wanted = zone.mix.reduce((sum, [, n]) => sum + n, 0);
    assert.equal(sizes.get(zone.code), wanted, zone.code);
  }
});

test('at least 12 devices have a temperature rule, in at least 3 zones', () => {
  const serverRooms = devices.filter((d) => d.kind === 'server_room');
  assert.ok(serverRooms.length >= 12);
  assert.ok(new Set(serverRooms.map((d) => d.zoneCode)).size >= 3);
});

test('it is deterministic', () => {
  assert.deepEqual(buildRegistry(originals), buildRegistry(originals));
});

test('the committed files are what it writes: devices.json from this script, rules.json from ingest', async () => {
  const files = await renderFiles();
  for (const [name, text] of Object.entries(files)) {
    assert.equal(
      readFileSync(new URL(name, FIXTURE_DIR), 'utf8'),
      text,
      `${name} has drifted: run node scripts/gen-registry-100.mjs`,
    );
  }
});

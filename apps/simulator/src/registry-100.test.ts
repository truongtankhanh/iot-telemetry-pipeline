import { METRIC_NAMES } from '@itp/telemetry-contract';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseRules } from './rules-source.ts';
import { parseAnomalies } from './scenario-document.ts';
import { expectedAlerts } from './scenario-expectations.ts';
import { ScenarioLibrary } from './scenario-library.ts';
import { BUILT_IN_SCENARIOS } from './scenarios.ts';
import type { DeviceSpec } from './signals.ts';
import { T0 } from './test-support.ts';

// The registry for the Simulation lab's scale check: apps/simulator/fixtures/devices-100/, written by
// scripts/gen-registry-100.mjs. Ingest reads the same directory as its CONFIG_DIR, so it has to pass what ingest
// checks at boot; its own tests are NestJS and are not imported here (as rules-source.ts says of parseRules).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const registry = JSON.parse(read('../fixtures/devices-100/devices.json')) as {
  devices: (DeviceSpec & { name: string })[];
};
const { devices } = registry;
const rulesText = read('../fixtures/devices-100/rules.json');

describe('the 100-device registry', () => {
  it('has what ingest requires of devices.json: 100 devices with unique ids that fit a topic', () => {
    assert.equal(devices.length, 100);
    assert.equal(new Set(devices.map((d) => d.id)).size, 100, 'unique ids');
    for (const device of devices) {
      for (const key of ['id', 'kind', 'zoneCode', 'name'] as const) {
        assert.ok(typeof device[key] === 'string' && device[key] !== '', `${device.id}.${key}`);
      }
      assert.match(device.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
      assert.match(device.zoneCode, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
      assert.ok(device.metrics.length > 0, `${device.id} has metrics`);
      for (const metric of device.metrics) assert.ok(METRIC_NAMES.includes(metric), metric);
    }
    assert.equal(new Set(devices.map((d) => d.zoneCode)).size, 20, 'zones');
  });

  it('has the rules of ingest, and each rule watches a metric that a device of its kind reports', () => {
    assert.equal(rulesText, read('../../ingest/config/rules.json'));
    const rules = parseRules(JSON.parse(rulesText));
    const reported = new Map<string, Set<string>>();
    for (const device of devices) {
      const metrics = reported.get(device.kind) ?? new Set<string>();
      for (const metric of device.metrics) metrics.add(metric);
      reported.set(device.kind, metrics);
    }
    for (const rule of rules) {
      assert.ok(
        reported.get(rule.kind)?.has(rule.metric),
        `${rule.id}: ${rule.kind} ${rule.metric}`,
      );
    }
  });

  it('keeps the built-in scenarios usable, so a scenario can be compared with an injection', () => {
    const library = new ScenarioLibrary({ builtIn: BUILT_IN_SCENARIOS, devices });
    assert.deepEqual(library.rejected, []);
    assert.deepEqual(
      library.names(),
      BUILT_IN_SCENARIOS.map((s) => s.name),
    );
  });

  it('turns a breach on 12 devices in 3 zones, 2 s apart, into 12 alerts with the real rules', () => {
    const targets = [
      ...devices.filter((d) => d.zoneCode === 'BLD-DC').slice(0, 6),
      ...devices.filter((d) => d.zoneCode === 'BLD-LIB' && d.kind === 'server_room').slice(0, 3),
      ...devices.filter((d) => d.zoneCode === 'BLD-LAB' && d.kind === 'server_room').slice(0, 3),
    ];
    assert.equal(targets.length, 12);
    const list = parseAnomalies(
      targets.map((d, i) => ({
        deviceId: d.id,
        metric: 'temperature_c',
        value: 29.2,
        startAt: 20 + 2 * i,
        duration: 60,
      })),
      { devices, max: 100 },
    );
    assert.ok(list.ok);

    const rules = { available: true, reason: null, items: parseRules(JSON.parse(rulesText)) };
    const expected = expectedAlerts(
      { name: 'preview', description: '', anomalies: list.anomalies },
      {
        devices,
        rules,
        intervalMs: 2000,
        intervalMsOf: () => 2000,
        needsStart: new Set(),
        baseMs: T0,
      },
    );
    assert.ok(expected.available);
    assert.equal(expected.alerts.length, 12);
    assert.deepEqual(new Set(expected.alerts.map((a) => a.ruleId)), new Set(['server-room-hot']));
    const opens = expected.alerts.map((a) => a.opensAtS);
    const clears = expected.alerts.map((a) => a.clearsAtS);
    assert.deepEqual([Math.min(...opens), Math.max(...opens)], [24, 46]);
    assert.deepEqual(
      [Math.min(...(clears as number[])), Math.max(...(clears as number[]))],
      [80, 102],
    );
    assert.deepEqual(expected.quiet, []);
  });
});

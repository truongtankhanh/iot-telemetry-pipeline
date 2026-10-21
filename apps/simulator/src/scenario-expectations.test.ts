import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RulesView } from './rules-source.ts';
import { type ExpectationOptions, expectedAlerts } from './scenario-expectations.ts';
import type { Anomaly, DeviceSpec } from './signals.ts';
import { DEVICES, T0 } from './test-support.ts';

const HUB: DeviceSpec = {
  id: 'hub-power-01',
  kind: 'power_meter',
  zoneCode: 'BLD-HUB',
  metrics: ['power_kw'],
};
const ALL_DEVICES = [...DEVICES, HUB];

/** The rules of `apps/ingest/config/rules.json` that these cases use, plus one that fires below a value. */
const RULES: RulesView = {
  available: true,
  reason: null,
  items: [
    {
      id: 'server-room-hot',
      kind: 'server_room',
      metric: 'temperature_c',
      direction: 'above',
      raise: 27,
      clear: 25.5,
      for: 3,
      severity: 'high',
      title: 'Server room temperature high',
    },
    {
      id: 'indoor-co2',
      kind: 'indoor_air',
      metric: 'co2_ppm',
      direction: 'above',
      raise: 1200,
      clear: 1000,
      for: 3,
      severity: 'medium',
      title: 'Poor air quality (CO₂)',
    },
    {
      id: 'power-over-contract',
      kind: 'power_meter',
      metric: 'power_kw',
      direction: 'above',
      raise: 180,
      clear: 160,
      for: 2,
      severity: 'low',
      title: 'Power draw above contracted capacity',
    },
    {
      id: 'server-room-dry',
      kind: 'server_room',
      metric: 'humidity_pct',
      direction: 'below',
      raise: 30,
      clear: 35,
      for: 2,
      severity: 'low',
      title: 'Server room humidity low',
    },
  ],
};

const anomaly = (change: Partial<Anomaly> = {}): Anomaly => ({
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 20,
  duration: 60,
  ...change,
});

/**
 * 12:00 on campus is T0. PEAK is chosen so that the clock reads 13:00:00 (the daily peak of CO₂, where the
 * baseline is exactly 1000 ppm) at second 110, the end of the CO₂ anomaly below; the baseline reads whole
 * minutes. NIGHT is 03:00 on campus.
 */
const PEAK = Date.parse('2026-10-01T05:58:10Z');
const NIGHT = Date.parse('2026-10-01T20:00:00Z');

function expect(anomalies: Anomaly[], overrides: Partial<ExpectationOptions> = {}) {
  const result = expectedAlerts(
    { name: 'case', description: '', anomalies },
    {
      devices: ALL_DEVICES,
      rules: RULES,
      intervalMs: 2000,
      intervalMsOf: () => 2000,
      needsStart: new Set(),
      baseMs: T0,
      ...overrides,
    },
  );
  assert.ok(result.available, 'the expectation was not available');
  return result;
}

describe('expectedAlerts: the ticket', () => {
  it('opens at the third tick at or after the start and clears at the first tick at or after the end', () => {
    const result = expect([anomaly()]);
    assert.deepEqual(result.alerts, [
      {
        ruleId: 'server-room-hot',
        title: 'Server room temperature high',
        severity: 'high',
        deviceId: 'dc-env-01',
        metric: 'temperature_c',
        opensAtS: 24,
        opensMargin: false,
        clearsAtS: 80,
        clearsUncertain: false,
      },
    ]);
    assert.deepEqual(result.quiet, []);
    assert.equal(result.intervalS, 2);
    assert.equal(result.horizonS, 80);
  });

  it('counts the ticks of a start that falls between two of them from the next one', () => {
    // Ticks at 2 s: a start at 21 s is first seen at 22 s, so the third breach is at 26 s, and an end at 81 s
    // is first seen as baseline at 82 s.
    const [alert] = expect([anomaly({ startAt: 21, duration: 60 })]).alerts;
    assert.equal(alert?.opensAtS, 26);
    assert.equal(alert?.clearsAtS, 82);
  });

  it('follows the rule: two readings are enough for a rule with for 2', () => {
    const [alert] = expect([
      anomaly({
        deviceId: 'hub-power-01',
        metric: 'power_kw',
        value: 190,
        startAt: 10,
        duration: 45,
      }),
    ]).alerts;
    assert.equal(alert?.ruleId, 'power-over-contract');
    assert.equal(alert?.opensAtS, 12);
    assert.equal(alert?.clearsAtS, 56);
  });

  it('works for a rule that fires below a value', () => {
    const [alert] = expect([
      anomaly({ metric: 'humidity_pct', value: 10, startAt: 0, duration: 20 }),
    ]).alerts;
    assert.equal(alert?.ruleId, 'server-room-dry');
    assert.equal(alert?.opensAtS, 2);
    assert.equal(alert?.clearsAtS, 20);
  });
});

describe('expectedAlerts: shapes', () => {
  it('opens a ramp when it has crossed the raise line for long enough, and clears at the end', () => {
    // 22.5 + 17.5 · t/40 passes 27 between 10 s and 12 s; the readings at 12, 14 and 16 s are three breaches.
    const [alert] = expect([
      anomaly({ shape: 'ramp', value: 40, startAt: 0, duration: 40 }),
    ]).alerts;
    assert.equal(alert?.opensAtS, 16);
    assert.equal(alert?.clearsAtS, 40);
    assert.equal(alert?.opensMargin, false);
  });

  it('clears a spike before its window ends, when it falls back under the clear line', () => {
    const [alert] = expect([
      anomaly({ shape: 'spike', value: 40, startAt: 0, duration: 40 }),
    ]).alerts;
    assert.equal(alert?.opensAtS, 10);
    assert.equal(alert?.clearsAtS, 38);
  });

  it('plays a lane with two anomalies in time order', () => {
    const result = expect([
      anomaly({ startAt: 0, duration: 20 }),
      anomaly({ startAt: 40, duration: 20, value: 30 }),
    ]);
    assert.deepEqual(
      result.alerts.map((a) => [a.opensAtS, a.clearsAtS]),
      [
        [4, 20],
        [44, 60],
      ],
    );
  });
});

describe('expectedAlerts: what raises nothing', () => {
  it('says there is no rule for a metric nothing watches', () => {
    const result = expect([
      anomaly({ deviceId: 'lib-air-01', metric: 'temperature_c', value: 30 }),
    ]);
    assert.deepEqual(result.alerts, []);
    assert.deepEqual(result.quiet, [
      { deviceId: 'lib-air-01', metric: 'temperature_c', why: 'no-rule' },
    ]);
  });

  it('says a value that stays under the raise line never crosses it', () => {
    const result = expect([anomaly({ value: 26.5 })]);
    assert.deepEqual(result.alerts, []);
    assert.deepEqual(result.quiet, [
      { deviceId: 'dc-env-01', metric: 'temperature_c', why: 'never-crosses' },
    ]);
  });

  it('does not open a rule on a value equal to the raise line (the breach is strict)', () => {
    assert.equal(expect([anomaly({ value: 27 })]).alerts.length, 0);
  });

  it('does not count a short anomaly that ends before the rule has its readings', () => {
    // 5 s at 2 s ticks is three readings (20, 22, 24): enough; 4 s is two (20, 22): not.
    assert.equal(expect([anomaly({ duration: 5 })]).alerts.length, 1);
    assert.equal(expect([anomaly({ duration: 4 })]).alerts.length, 0);
  });
});

describe('expectedAlerts: what the numbers cannot promise', () => {
  it('flags a breach that is within the jitter of the raise line', () => {
    const [alert] = expect([anomaly({ value: 27.1 })]).alerts;
    assert.equal(alert?.opensMargin, true);
    assert.equal(expect([anomaly({ value: 27.5 })]).alerts[0]?.opensMargin, false);
  });

  it('calls the clear uncertain when the baseline is within the noise of the clear line', () => {
    const [alert] = expect(
      [
        anomaly({
          deviceId: 'hub-power-01',
          metric: 'power_kw',
          value: 190,
          startAt: 10,
          duration: 45,
        }),
      ],
      { baseMs: T0 },
    ).alerts;
    // 120 + 35 · sin(75°) = 153.8 at noon against a clear line of 160 and a noise of 8.
    assert.equal(alert?.clearsAtS, 56);
    assert.equal(alert?.clearsUncertain, true);
  });

  it('finds no clear at the daily peak of CO₂, where the baseline equals the clear line', () => {
    const [alert] = expect(
      [
        anomaly({
          deviceId: 'lib-air-01',
          metric: 'co2_ppm',
          value: 1450,
          startAt: 20,
          duration: 90,
        }),
      ],
      { baseMs: PEAK },
    ).alerts;
    assert.equal(alert?.opensAtS, 24);
    assert.equal(alert?.clearsAtS, null);
    assert.equal(alert?.clearsUncertain, true);
  });

  it('clears CO₂ at the end, with a margin, at noon and without one at night', () => {
    const co2 = anomaly({
      deviceId: 'lib-air-01',
      metric: 'co2_ppm',
      value: 1450,
      startAt: 20,
      duration: 90,
    });
    const noon = expect([co2], { baseMs: T0 }).alerts[0];
    assert.equal(noon?.clearsAtS, 110);
    assert.equal(noon?.clearsUncertain, true);
    const night = expect([co2], { baseMs: NIGHT }).alerts[0];
    assert.equal(night?.clearsAtS, 110);
    assert.equal(night?.clearsUncertain, false);
  });
});

describe('expectedAlerts: the tick grid', () => {
  it('begins the ticks of a device the run starts at one interval, not at zero', () => {
    const base = anomaly({ startAt: 0, duration: 30 });
    assert.equal(expect([base]).alerts[0]?.opensAtS, 4);
    assert.equal(expect([base], { needsStart: new Set(['dc-env-01']) }).alerts[0]?.opensAtS, 6);
  });

  it('uses the interval of the device, not the engine default', () => {
    const result = expect([anomaly()], { intervalMsOf: () => 1000 });
    assert.equal(result.alerts[0]?.opensAtS, 22);
    assert.equal(result.intervalS, 2);
  });

  it('refuses an interval so short that the walk would be too long', () => {
    const result = expectedAlerts(
      { name: 'case', description: '', anomalies: [anomaly({ startAt: 0, duration: 100 })] },
      {
        devices: ALL_DEVICES,
        rules: RULES,
        intervalMs: 1,
        intervalMsOf: () => 1,
        needsStart: new Set(),
        baseMs: T0,
      },
    );
    assert.equal(result.available, false);
    assert.match(
      result.available ? '' : result.reason,
      /^A publish interval of 1 ms is too short to work out the alerts of a 100 s scenario/,
    );
  });

  it('still works out a short scenario at a short interval', () => {
    // 1 s at 1 ms is 1,000 ticks plus the search past the end: under the limit.
    const result = expectedAlerts(
      { name: 'case', description: '', anomalies: [anomaly({ startAt: 0, duration: 1 })] },
      {
        devices: ALL_DEVICES,
        rules: RULES,
        intervalMs: 1,
        intervalMsOf: () => 1,
        needsStart: new Set(),
        baseMs: T0,
      },
    );
    assert.equal(result.available, true);
  });
});

describe('expectedAlerts: several alerts', () => {
  it('lists them by the time they open, then device and rule', () => {
    const result = expect([
      anomaly({ value: 29 }),
      anomaly({
        deviceId: 'lib-air-01',
        metric: 'co2_ppm',
        value: 1450,
        startAt: 10,
        duration: 30,
      }),
    ]);
    assert.deepEqual(
      result.alerts.map((a) => [a.ruleId, a.opensAtS]),
      [
        ['indoor-co2', 14],
        ['server-room-hot', 24],
      ],
    );
  });
});

describe('expectedAlerts: the curve', () => {
  it('samples the noise-free value on the tick grid, from second 0 to the horizon', () => {
    const [lane] = expect([anomaly()]).series;
    assert.equal(lane?.deviceId, 'dc-env-01');
    assert.equal(lane?.stepS, 2);
    assert.equal(lane?.points.length, 41);
    assert.equal(lane?.points[0], 22.5);
    assert.equal(lane?.points[9], 22.5); // 18 s
    assert.equal(lane?.points[10], 29.2); // 20 s
    assert.equal(lane?.points[39], 29.2); // 78 s
    assert.equal(lane?.points[40], 22.5); // 80 s
  });

  it('has one lane for each device and metric, not for each anomaly', () => {
    const result = expect([
      anomaly({ startAt: 0, duration: 20 }),
      anomaly({ startAt: 40, duration: 20 }),
      anomaly({ metric: 'humidity_pct', value: 70, startAt: 0, duration: 10 }),
    ]);
    assert.deepEqual(
      result.series.map((lane) => [lane.deviceId, lane.metric]),
      [
        ['dc-env-01', 'temperature_c'],
        ['dc-env-01', 'humidity_pct'],
      ],
    );
  });

  it('keeps a long scenario to at most 121 points by widening the step', () => {
    const [lane] = expect([anomaly({ startAt: 0, duration: 3600 })]).series;
    assert.ok((lane?.points.length ?? 0) <= 121);
    assert.equal(lane?.stepS, 30);
  });
});

describe('expectedAlerts: no rules', () => {
  it('says why, and gives no guess', () => {
    const result = expectedAlerts(
      { name: 'case', description: '', anomalies: [anomaly()] },
      {
        devices: ALL_DEVICES,
        rules: { available: false, reason: 'cannot read rules.json (ENOENT)', items: [] },
        intervalMs: 2000,
        intervalMsOf: () => 2000,
        needsStart: new Set(),
        baseMs: T0,
      },
    );
    assert.deepEqual(result, { available: false, reason: 'cannot read rules.json (ENOENT)' });
  });
});

import { describe, expect, it } from 'vitest';
import type { DeviceInfo, ExpectedAlert, RuleInfo, RulesView } from '../api/types';
import {
  breachValue,
  buildAnomalies,
  conflictSentence,
  DEFAULT_FAULT,
  defaultMetric,
  engineConflicts,
  FAULT_TILES,
  type FaultDraft,
  hasErrors,
  looseAnomalies,
  MAX_DURATION_S,
  planFault,
  sliderModel,
  staggerSentence,
  STOP_OPTIONS,
  toRequests,
  validateFault,
  windowText,
} from './labFault';

const rule = (change: Partial<RuleInfo> = {}): RuleInfo => ({
  id: 'server-room-hot',
  kind: 'server_room',
  metric: 'temperature_c',
  direction: 'above',
  raise: 27,
  clear: 25.5,
  for: 3,
  severity: 'high',
  title: 'Server room temperature high',
  ...change,
});

const rules: RulesView = {
  available: true,
  reason: null,
  items: [
    rule(),
    rule({ id: 'humid', metric: 'humidity_pct', raise: 60, clear: 55 }),
    rule({ id: 'co2', kind: 'indoor_air', metric: 'co2_ppm', raise: 1200, clear: 1000 }),
  ],
};

const device = (id: string, kind: string, metrics: DeviceInfo['metrics']): DeviceInfo => ({
  id,
  kind,
  zoneCode: 'BLD-X',
  metrics,
});
const dc1 = device('dc-env-01', 'server_room', ['temperature_c', 'humidity_pct']);
const dc2 = device('dc-env-02', 'server_room', ['temperature_c', 'humidity_pct']);
const lib = device('lib-air-01', 'indoor_air', ['co2_ppm', 'temperature_c']);
const hub = device('hub-power-01', 'power_meter', ['power_kw']);

const profiles = { 'dc-env-01': { temperature_c: { baseline: 22.5, noise: 0.3, dailySwing: 0 } } };
const engine = { elapsedS: 100, anomalies: [] };

describe('breachValue', () => {
  it('goes a little beyond the raise line, whatever the metric', () => {
    expect(breachValue('temperature_c', rule(), null)).toBe(29.2);
    expect(breachValue('humidity_pct', rule({ raise: 60 }), null)).toBe(64.8);
    expect(breachValue('co2_ppm', rule({ raise: 1200 }), null)).toBe(1296);
    expect(breachValue('power_kw', rule({ raise: 180 }), null)).toBe(194.4);
  });

  it('goes under the line for a rule that fires below a value', () => {
    expect(breachValue('temperature_c', rule({ direction: 'below', raise: 30 }), null)).toBe(27.6);
  });

  it('stays inside the range of the contract', () => {
    expect(breachValue('co2_ppm', rule({ raise: 10_000 }), null)).toBe(10_000);
    expect(breachValue('humidity_pct', rule({ direction: 'below', raise: 1 }), null)).toBe(0);
  });

  it('takes a tenth of the range above the baseline when no rule watches the metric', () => {
    expect(breachValue('temperature_c', null, 22.5)).toBe(35);
  });

  it('has no value for a metric it cannot place', () => {
    expect(breachValue('temperature_c', null, null)).toBeNull();
    expect(breachValue('wind_mps', rule(), 3)).toBeNull();
  });
});

describe('sliderModel', () => {
  it('lays the contract range as the track and the rule lines as marks', () => {
    const slider = sliderModel('temperature_c', 29.2, rule())!;
    expect([slider.min, slider.max, slider.step]).toEqual([-40, 85, 0.1]);
    expect(slider.valuePct).toBeCloseTo(55.36, 2);
    expect(slider.raisePct).toBeCloseTo(53.6, 2);
    expect(slider.clearPct).toBeCloseTo(52.4, 2);
  });

  it('has no marks without a rule, a whole step for ppm, and nothing for an unknown metric', () => {
    expect(sliderModel('co2_ppm', 1450, null)).toMatchObject({
      step: 1,
      raisePct: null,
      clearPct: null,
    });
    expect(sliderModel('wind_mps', 1, null)).toBeNull();
  });

  it('keeps the thumb on the track', () => {
    expect(sliderModel('temperature_c', 500, null)!.valuePct).toBe(100);
    expect(sliderModel('temperature_c', null, null)!.valuePct).toBe(0);
  });
});

describe('validateFault', () => {
  const ok = { metric: 'temperature_c', value: 29.2 };

  it('finds nothing wrong with the defaults', () => {
    expect(validateFault(DEFAULT_FAULT, ok)).toEqual({});
  });

  it('names the field that is wrong', () => {
    expect(validateFault(DEFAULT_FAULT, { metric: 'temperature_c', value: 90 }).value).toBe(
      'Enter a value from -40 to 85 °C',
    );
    expect(validateFault(DEFAULT_FAULT, { metric: 'temperature_c', value: null }).value).toBe(
      'Enter a value',
    );
    expect(validateFault(DEFAULT_FAULT, { metric: null, value: 1 }).metric).toMatch(
      /Choose a metric/,
    );
    expect(validateFault({ ...DEFAULT_FAULT, startAt: -1 }, ok).startAt).toMatch(/0 s or more/);
    expect(validateFault({ ...DEFAULT_FAULT, startAt: null }, ok).startAt).toMatch(/0 s or more/);
    expect(validateFault({ ...DEFAULT_FAULT, stagger: -2 }, ok).stagger).toMatch(/0 s or more/);
  });

  it('bounds the duration of a timed fault, and ignores it for a manual one', () => {
    for (const duration of [0, -5, MAX_DURATION_S + 1, null]) {
      expect(validateFault({ ...DEFAULT_FAULT, duration }, ok).duration).toMatch(/at most 3600 s/);
    }
    expect(validateFault({ ...DEFAULT_FAULT, duration: 3600 }, ok)).toEqual({});
    expect(validateFault({ ...DEFAULT_FAULT, duration: null, stop: 'manual' }, ok)).toEqual({});
  });

  it('says whether there are errors', () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ value: 'x' })).toBe(true);
  });
});

describe('buildAnomalies', () => {
  const input = { metric: 'temperature_c', value: 29.2, deviceIds: ['a', 'b', 'c'] };

  it('starts each device one stagger after the one before, in seconds from now', () => {
    const anomalies = buildAnomalies(DEFAULT_FAULT, input);
    expect(anomalies.map((a) => [a.deviceId, a.startAt, a.duration])).toEqual([
      ['a', 20, 60],
      ['b', 22, 60],
      ['c', 24, 60],
    ]);
    expect(anomalies[0]).toEqual({
      deviceId: 'a',
      metric: 'temperature_c',
      value: 29.2,
      startAt: 20,
      duration: 60,
    });
  });

  it('leaves the shape out for a step and puts it in for a ramp or a spike', () => {
    expect('shape' in buildAnomalies(DEFAULT_FAULT, input)[0]!).toBe(false);
    expect(buildAnomalies({ ...DEFAULT_FAULT, shape: 'ramp' }, input)[0]!.shape).toBe('ramp');
    expect(buildAnomalies({ ...DEFAULT_FAULT, shape: 'spike' }, input)[1]!.shape).toBe('spike');
  });

  it('gives a manual fault the longest duration', () => {
    const anomalies = buildAnomalies({ ...DEFAULT_FAULT, stop: 'manual', duration: null }, input);
    expect(anomalies.every((a) => a.duration === MAX_DURATION_S)).toBe(true);
  });

  it('has no stagger for one device or a stagger of 0', () => {
    expect(buildAnomalies(DEFAULT_FAULT, { ...input, deviceIds: ['a'] })[0]!.startAt).toBe(20);
    const together = buildAnomalies({ ...DEFAULT_FAULT, stagger: 0 }, input);
    expect(new Set(together.map((a) => a.startAt))).toEqual(new Set([20]));
  });

  it('keeps a fractional stagger exact', () => {
    const starts = buildAnomalies({ ...DEFAULT_FAULT, stagger: 0.1, startAt: 0 }, input).map(
      (a) => a.startAt,
    );
    expect(starts).toEqual([0, 0.1, 0.2]);
  });

  it('makes nothing from a form that cannot be sent', () => {
    expect(buildAnomalies({ ...DEFAULT_FAULT, startAt: null }, input)).toEqual([]);
    expect(buildAnomalies({ ...DEFAULT_FAULT, duration: 0 }, input)).toEqual([]);
  });
});

describe('staggerSentence', () => {
  const twelve = buildAnomalies(DEFAULT_FAULT, {
    metric: 'temperature_c',
    value: 29.2,
    deviceIds: Array.from({ length: 12 }, (_, i) => `d${i}`),
  });
  const alert = (opensAtS: number): ExpectedAlert => ({
    ruleId: 'r',
    title: 't',
    severity: 'high',
    deviceId: 'd',
    metric: 'temperature_c',
    opensAtS,
    opensMargin: false,
    clearsAtS: 80,
    clearsUncertain: false,
  });

  it('says nothing for one device', () => {
    expect(staggerSentence(twelve.slice(0, 1), null)).toBeNull();
  });

  it('says when the first and the last device start', () => {
    expect(staggerSentence(twelve, null)).toBe('First device at 20 s, the last of 12 at 42 s.');
    expect(staggerSentence(twelve, [])).toBe('First device at 20 s, the last of 12 at 42 s.');
  });

  it("adds the simulator's own times for the alerts", () => {
    expect(staggerSentence(twelve, [alert(46), alert(24), alert(30)])).toBe(
      'First device at 20 s, the last of 12 at 42 s. Alerts are expected from 24 s to 46 s.',
    );
  });
});

describe('toRequests', () => {
  it("puts the times on the engine's anomaly clock", () => {
    const anomalies = buildAnomalies(DEFAULT_FAULT, {
      metric: 'temperature_c',
      value: 29.2,
      deviceIds: ['a', 'b'],
    });
    const requests = toRequests(anomalies, 100.25);
    expect(requests.map((r) => r.startAt)).toEqual([120.25, 122.25]);
    expect(requests[0]).toMatchObject({ deviceId: 'a', duration: 60, value: 29.2 });
  });
});

describe('engineConflicts and conflictSentence', () => {
  const playing = {
    id: 'a1',
    anomaly: {
      deviceId: 'dc-env-01',
      metric: 'temperature_c' as const,
      value: 29,
      startAt: 90,
      duration: 50,
    },
  };
  const mine = (change: Record<string, unknown> = {}) => ({
    deviceId: 'dc-env-01',
    metric: 'temperature_c' as const,
    value: 29.2,
    startAt: 20,
    duration: 60,
    ...change,
  });

  it('finds an anomaly on the same device and metric that is playing in the window, as seconds from now', () => {
    expect(engineConflicts([mine()], { elapsedS: 100, anomalies: [playing] })).toEqual([
      { id: 'a1', deviceId: 'dc-env-01', metric: 'temperature_c', fromS: -10, toS: 40 },
    ]);
  });

  it('finds nothing for a window that only touches, another metric, another device, or one that is over', () => {
    const state = { elapsedS: 100, anomalies: [playing] };
    expect(engineConflicts([mine({ startAt: 40 })], state)).toEqual([]);
    expect(engineConflicts([mine({ metric: 'humidity_pct' })], state)).toEqual([]);
    expect(engineConflicts([mine({ deviceId: 'dc-env-02' })], state)).toEqual([]);
    expect(engineConflicts([mine()], { elapsedS: 200, anomalies: [playing] })).toEqual([]);
  });

  it('writes the sentence for one that is playing, one that is coming, and a long list', () => {
    expect(conflictSentence([])).toBeNull();
    expect(
      conflictSentence([
        { id: 'a', deviceId: 'dc-env-01', metric: 'temperature_c', fromS: -10, toS: 40 },
      ]),
    ).toBe('dc-env-01 already has a fault on temperature_c until 40 s from now');
    expect(
      conflictSentence([
        { id: 'a', deviceId: 'dc-env-03', metric: 'temperature_c', fromS: 20, toS: 80 },
      ]),
    ).toBe('dc-env-03 already has a fault on temperature_c from 20 s to 80 s from now');
    const many = ['a', 'b', 'c', 'd'].map((x) => ({
      id: x,
      deviceId: `dc-${x}`,
      metric: 'temperature_c',
      fromS: 0,
      toS: 10,
    }));
    expect(conflictSentence(many)).toMatch(/^dc-a .*; dc-b .* and 2 more$/);
  });
});

describe('the tiles and the stop conditions', () => {
  it('has nine tiles and only the breach can be chosen', () => {
    expect(FAULT_TILES).toHaveLength(9);
    expect(FAULT_TILES.filter((t) => t.available).map((t) => t.id)).toEqual(['breach']);
    // Each one that cannot be chosen says where to find it: a switch on the Faults page, or a device to pause in the Fleet.
    expect(FAULT_TILES.find((t) => t.id === 'silent')?.reason).toBe(
      'Pause or stop the device in the Fleet',
    );
    for (const tile of FAULT_TILES.filter((t) => !t.available && t.id !== 'silent')) {
      expect(tile.reason, tile.id).toBe('A switch, not a timed fault: set it on the Faults page');
    }
    expect(FAULT_TILES.every((t) => t.available === (t.reason === null))).toBe(true);
  });

  it('has Timed and Manual, and says why Alert clears cannot be chosen', () => {
    expect(STOP_OPTIONS.filter((o) => o.available).map((o) => o.id)).toEqual(['timed', 'manual']);
    expect(STOP_OPTIONS.find((o) => o.id === 'alert-clears')?.reason).toMatch(
      /only after the fault has ended/,
    );
  });
});

describe('defaultMetric and planFault', () => {
  const plan = (change: Partial<Parameters<typeof planFault>[0]> = {}) =>
    planFault({
      draft: DEFAULT_FAULT,
      reached: [dc1, dc2, lib],
      rules,
      profiles,
      engine,
      ...change,
    });

  it('takes the metric the most devices report', () => {
    expect(defaultMetric([dc1, dc2, lib])).toBe('temperature_c');
    expect(defaultMetric([])).toBeNull();
  });

  it('makes a fault that can be sent from the defaults: the rule of the first device decides the value', () => {
    const p = plan();
    expect(p.metric).toBe('temperature_c');
    expect(p.value).toBe(29.2);
    expect(p.rule?.id).toBe('server-room-hot');
    expect(p.deviceIds).toEqual(['dc-env-01', 'dc-env-02', 'lib-air-01']);
    expect(p.skipped).toEqual([]);
    expect(p.anomalies.map((a) => a.startAt)).toEqual([20, 22, 24]);
    expect(p.blocker).toBeNull();
  });

  it('leaves out the devices that do not report the metric, and says which', () => {
    const p = plan({ reached: [dc1, hub, dc2] });
    expect(p.deviceIds).toEqual(['dc-env-01', 'dc-env-02']);
    expect(p.skipped).toEqual(['hub-power-01']);
  });

  it('falls back to the common metric when the form names one that no device reports', () => {
    const p = plan({ draft: { ...DEFAULT_FAULT, metric: 'power_kw' } });
    expect(p.metric).toBe('temperature_c');
    expect(plan({ draft: { ...DEFAULT_FAULT, metric: 'humidity_pct' } }).deviceIds).toEqual([
      'dc-env-01',
      'dc-env-02',
    ]);
  });

  it('uses the value of the form when it has one', () => {
    expect(plan({ draft: { ...DEFAULT_FAULT, value: 31 } }).anomalies[0]?.value).toBe(31);
  });

  it('says why it cannot be sent, one reason at a time', () => {
    expect(plan({ reached: [] }).blocker).toBe('Choose at least one target');
    expect(plan({ draft: { ...DEFAULT_FAULT, tile: 'drop' } }).blocker).toBe(
      'A switch, not a timed fault: set it on the Faults page',
    );
    expect(plan({ draft: { ...DEFAULT_FAULT, tile: 'silent' } }).blocker).toBe(
      'Pause or stop the device in the Fleet',
    );
    expect(plan({ draft: { ...DEFAULT_FAULT, value: 99 } }).blocker).toMatch(
      /Enter a value from -40 to 85/,
    );
    const bad: FaultDraft = { ...DEFAULT_FAULT, duration: 0 };
    expect(plan({ draft: bad }).anomalies).toEqual([]);
    expect(plan({ draft: bad }).blocker).toMatch(/Duration must be above 0 s/);
  });

  it('is blocked by an anomaly already on the engine, and names it', () => {
    const p = plan({
      engine: {
        elapsedS: 100,
        anomalies: [
          {
            id: 'a9',
            anomaly: {
              deviceId: 'dc-env-02',
              metric: 'temperature_c',
              value: 29,
              startAt: 110,
              duration: 60,
            },
          },
        ],
      },
    });
    expect(p.conflicts.map((c) => c.id)).toEqual(['a9']);
    expect(p.blocker).toBe(
      'dc-env-02 already has a fault on temperature_c from 10 s to 70 s from now',
    );
  });

  it('has no value, and a reason, for a power meter without a profile or a rule', () => {
    const p = plan({ reached: [hub] });
    expect(p.metric).toBe('power_kw');
    expect(p.value).toBeNull();
    expect(p.blocker).toBe('Enter a value');
  });
});

describe('windowText and looseAnomalies', () => {
  it('says when a fault on the engine plays, from now', () => {
    expect(windowText(-10, 40)).toBe('until 40 s from now');
    expect(windowText(0, 12.34)).toBe('until 12.3 s from now');
    expect(windowText(20, 80)).toBe('from 20 s to 80 s from now');
    expect(windowText(-60, -5)).toBe('ended');
  });

  it('leaves out the faults a scenario run owns', () => {
    const entry = (id: string) => ({
      id,
      anomaly: {
        deviceId: 'd',
        metric: 'temperature_c' as const,
        value: 29,
        startAt: 1,
        duration: 60,
      },
    });
    const run = {
      id: 'r1',
      scenario: 's',
      startedAt: '2026-10-21T09:00:00.000Z',
      offsetS: 0,
      endsAtS: 60,
      anomalyIds: ['b'],
      startedDevices: [],
    };
    expect(
      looseAnomalies({ anomalies: [entry('a'), entry('b'), entry('c')] }, [run]).map((e) => e.id),
    ).toEqual(['a', 'c']);
    expect(looseAnomalies({ anomalies: [entry('a')] }, [])).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import type { DeviceInfo, RulesView, StateView } from '../api/types';
import { DEFAULT_DURATION_S, defaultAnomaly } from './timelineDefaults';
import { EMPTY_DOC, fromAnomalies } from './timelineEditor';

const rules: RulesView = {
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
  ],
};

const devices: DeviceInfo[] = [
  {
    id: 'dc-env-01',
    kind: 'server_room',
    zoneCode: 'BLD-DC',
    metrics: ['humidity_pct', 'temperature_c'],
  },
  {
    id: 'lib-air-01',
    kind: 'indoor_air',
    zoneCode: 'BLD-LIB',
    metrics: ['co2_ppm', 'temperature_c'],
  },
];

const profiles: StateView['profiles'] = {
  'lib-air-01': { co2_ppm: { baseline: 650, noise: 40, dailySwing: 350 } },
};

const input = (over = {}) => ({
  doc: EMPTY_DOC,
  devices,
  rules,
  profiles,
  selectedId: null,
  ...over,
});

const hot = {
  deviceId: 'dc-env-01',
  metric: 'temperature_c' as const,
  value: 29.2,
  startAt: 10,
  duration: 20,
};

describe('defaultAnomaly', () => {
  it('starts on the first device with a metric a rule watches, a little beyond its raise line', () => {
    expect(defaultAnomaly(input())).toEqual({
      deviceId: 'dc-env-01',
      metric: 'temperature_c', // not humidity_pct, which no rule watches
      value: 29.2,
      startAt: 0,
      duration: DEFAULT_DURATION_S,
    });
  });

  it('puts a new one on the signal of the selected anomaly, after it', () => {
    const doc = fromAnomalies([hot]);
    expect(defaultAnomaly(input({ doc, selectedId: 'a1' }))).toMatchObject({
      deviceId: 'dc-env-01',
      metric: 'temperature_c',
      startAt: 30,
      duration: 30,
    });
  });

  it('uses the baseline when no rule watches the metric, and stays inside the range', () => {
    const doc = fromAnomalies([{ ...hot, deviceId: 'lib-air-01', metric: 'co2_ppm' }]);
    const made = defaultAnomaly(input({ doc, selectedId: 'a1' }))!;
    expect(made.metric).toBe('co2_ppm');
    expect(made.value).toBeGreaterThan(650);
    expect(made.value).toBeLessThanOrEqual(10_000);
  });

  it('puts it where a lane was pointed at, as long as the gap holds', () => {
    const doc = fromAnomalies([hot, { ...hot, startAt: 80, duration: 10 }]);
    const at = (startAt: number) => ({ deviceId: 'dc-env-01', metric: 'temperature_c', startAt });
    expect(defaultAnomaly(input({ doc, at: at(40) }))).toMatchObject({ startAt: 40, duration: 30 });
    expect(defaultAnomaly(input({ doc, at: at(60) }))).toMatchObject({ startAt: 60, duration: 20 }); // 80 is next
    expect(defaultAnomaly(input({ doc, at: at(79.5) }))).toBeNull(); // under a second left
    expect(defaultAnomaly(input({ doc, at: at(15) }))).toBeNull(); // inside the first
  });

  it('can start a lane that has nothing yet at the second that was pointed at', () => {
    expect(
      defaultAnomaly(
        input({ at: { deviceId: 'lib-air-01', metric: 'temperature_c', startAt: 12.34 } }),
      ),
    ).toMatchObject({ deviceId: 'lib-air-01', metric: 'temperature_c', startAt: 12.3 });
  });

  it('has nothing to make without a device', () => {
    expect(defaultAnomaly(input({ devices: [] }))).toBeNull();
    expect(
      defaultAnomaly(input({ at: { deviceId: 'ghost', metric: 'temperature_c', startAt: 0 } })),
    ).toBeNull();
  });
});

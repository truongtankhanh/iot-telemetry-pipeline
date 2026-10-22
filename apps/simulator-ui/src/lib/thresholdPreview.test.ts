import { describe, expect, it } from 'vitest';
import type { Anomaly, DeviceInfo, Expected, ExpectedAlert, RulesView } from '../api/types';
import { previewItem, raisesFor, ruleLineFor } from './thresholdPreview';

const hot: Anomaly = {
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 20,
  duration: 60,
};
const later: Anomaly = { ...hot, startAt: 200, duration: 10 };
const other: Anomaly = { ...hot, deviceId: 'dc-env-02' };
const humid: Anomaly = { ...hot, metric: 'humidity_pct', value: 70 };

const alert = (deviceId: string, over: Partial<ExpectedAlert> = {}): ExpectedAlert => ({
  ruleId: 'server-room-hot',
  title: 'Server room temperature high',
  severity: 'high',
  deviceId,
  metric: 'temperature_c',
  opensAtS: 24,
  opensMargin: false,
  clearsAtS: 80,
  clearsUncertain: false,
  ...over,
});

const series = (deviceId: string, metric: Anomaly['metric'] = 'temperature_c') => ({
  deviceId,
  metric,
  stepS: 2,
  points: [22.5, 29.2, 22.5],
});

const expected = (over: Partial<Extract<Expected, { available: true }>> = {}): Expected => ({
  available: true,
  intervalS: 2,
  horizonS: 210,
  alerts: [alert('dc-env-01'), alert('dc-env-02', { opensAtS: 30 })],
  quiet: [{ deviceId: 'dc-env-01', metric: 'humidity_pct', why: 'no-rule' }],
  series: [series('dc-env-01'), series('dc-env-02'), series('dc-env-01', 'humidity_pct')],
  ...over,
});

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
    metrics: ['temperature_c', 'humidity_pct'],
  },
];

describe('previewItem', () => {
  it('narrows the scenario to the selected anomaly’s signal: its anomalies, series, alerts and notes', () => {
    const item = previewItem([hot, later, other, humid], hot, expected())!;
    expect(item.anomalies).toEqual([hot, later]);
    expect(item.lengthS).toBe(210);
    expect(item.expected).toMatchObject({ available: true });
    if (!item.expected.available) return;
    expect(item.expected.series).toEqual([series('dc-env-01')]);
    expect(item.expected.alerts.map((a) => a.deviceId)).toEqual(['dc-env-01']);
    expect(item.expected.quiet).toEqual([]);
  });

  it('keeps the quiet note of the signal that raises nothing', () => {
    const item = previewItem([humid], humid, expected())!;
    if (!item.expected.available) throw new Error('available');
    expect(item.expected.quiet).toEqual([
      { deviceId: 'dc-env-01', metric: 'humidity_pct', why: 'no-rule' },
    ]);
    expect(item.expected.alerts).toEqual([]);
  });

  it('has nothing honest to draw without a selection, an answer, the rules or a series', () => {
    expect(previewItem([hot], null, expected())).toBeNull();
    expect(previewItem([hot], hot, null)).toBeNull();
    expect(previewItem([hot], hot, { available: false, reason: 'no rules' })).toBeNull();
    expect(previewItem([hot], hot, expected({ series: [] }))).toBeNull();
  });
});

describe('ruleLineFor', () => {
  it('says the rule that watches the signal, in the Fleet’s words', () => {
    expect(ruleLineFor(rules, devices, hot)).toBe(
      'raise 27 · clear 25.5 · opens after 3 readings in a row',
    );
  });

  it('has none for a signal no rule watches, a device that is gone, or unreadable rules', () => {
    expect(ruleLineFor(rules, devices, humid)).toBeNull();
    expect(ruleLineFor(rules, devices, other)).toBeNull();
    expect(ruleLineFor({ available: false, reason: 'x', items: [] }, devices, hot)).toBeNull();
  });
});

describe('raisesFor', () => {
  it('waits for the simulator, and gives its reason when it cannot say', () => {
    expect(raisesFor(null, hot)).toBe('Working out the alerts…');
    expect(raisesFor({ available: false, reason: 'rules.json could not be read' }, hot)).toBe(
      'Expected alerts are not available: rules.json could not be read',
    );
  });

  it('says what the rules should raise for the signal, as the cards do', () => {
    expect(raisesFor(expected(), hot)).toBe(
      'Raises Server room temperature high (high) about 24 s; clears about 80 s.',
    );
  });

  it('says “or later” and “not known”, and one sentence for each alert', () => {
    const uncertain = expected({
      alerts: [
        alert('dc-env-01', { clearsUncertain: true }),
        alert('dc-env-01', { opensAtS: 200, clearsAtS: null }),
      ],
    });
    expect(raisesFor(uncertain, hot)).toBe(
      'Raises Server room temperature high (high) about 24 s; clears about 80 s or later. Raises Server room temperature high (high) about 200 s; clear time not known.',
    );
  });

  it('says why nothing is raised', () => {
    expect(raisesFor(expected(), humid)).toBe('No rule watches humidity_pct on dc-env-01.');
    expect(
      raisesFor(
        expected({
          quiet: [{ deviceId: 'dc-env-01', metric: 'humidity_pct', why: 'never-crosses' }],
        }),
        humid,
      ),
    ).toBe('humidity_pct on dc-env-01 never goes beyond a raise line.');
    expect(raisesFor(expected({ alerts: [], quiet: [] }), hot)).toBe('Raises no alert.');
  });
});

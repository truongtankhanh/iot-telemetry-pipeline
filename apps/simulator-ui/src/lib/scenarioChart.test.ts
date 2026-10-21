import { describe, expect, it } from 'vitest';
import scenariosFixture from '../api/fixtures/scenarios.json';
import { stateViewFixture } from '../api/fixtures/stateView';
import type { Anomaly, Expected, RulesView, ScenarioItem, ScenarioLibraryView } from '../api/types';
import {
  buildScenarioChart,
  chartKind,
  LANE_LIMIT,
  type LaneChartModel,
  playheadOf,
  ruleOf,
  type ValueChartModel,
} from './scenarioChart';

const [overheat, , afternoon] = (scenariosFixture as unknown as ScenarioLibraryView).scenarios as [
  ScenarioItem,
  ScenarioItem,
  ScenarioItem,
];
const { rules, devices } = stateViewFixture;

const value = (item: ScenarioItem, width = 400): ValueChartModel => {
  const chart = buildScenarioChart({ item, rules, devices, width });
  if (chart?.kind !== 'value') throw new Error('expected a value chart');
  return chart;
};
const lanes = (item: ScenarioItem, width = 400): LaneChartModel => {
  const chart = buildScenarioChart({ item, rules, devices, width });
  if (chart?.kind !== 'lanes') throw new Error('expected a lane chart');
  return chart;
};

describe('chartKind', () => {
  it('draws a value chart for one device and one metric and lanes for anything else', () => {
    expect(chartKind(overheat)).toBe('value');
    expect(chartKind(afternoon)).toBe('lanes');
  });

  it('keeps a sequence of anomalies on one signal a value chart', () => {
    const [first] = overheat.anomalies as [Anomaly];
    const sequence = { ...overheat, anomalies: [first, { ...first, startAt: 100 }] };
    expect(chartKind(sequence)).toBe('value');
  });

  it('draws lanes for one device with two metrics', () => {
    const [first] = overheat.anomalies as [Anomaly];
    const two = { ...overheat, anomalies: [first, { ...first, metric: 'humidity_pct' as const }] };
    expect(chartKind(two)).toBe('lanes');
  });
});

describe('ruleOf', () => {
  it('takes the rule the scenario raises', () => {
    expect(ruleOf(overheat, rules, devices)?.id).toBe('server-room-hot');
  });

  it('takes the rule that watches the signal when the scenario raises nothing', () => {
    const expected = overheat.expected as Extract<Expected, { available: true }>;
    const quiet: ScenarioItem = { ...overheat, expected: { ...expected, alerts: [] } };
    expect(ruleOf(quiet, rules, devices)?.id).toBe('server-room-hot');
  });

  it('has none for a signal nothing watches, or when the rules are not available', () => {
    const [first] = overheat.anomalies as [Anomaly];
    const expected = overheat.expected as Extract<Expected, { available: true }>;
    const unwatched: ScenarioItem = {
      ...overheat,
      anomalies: [{ ...first, deviceId: 'lib-air-01', metric: 'humidity_pct' }],
      expected: { ...expected, alerts: [] },
    };
    expect(ruleOf(unwatched, rules, devices)).toBeNull();
    expect(ruleOf(overheat, { available: false, reason: 'x', items: [] }, devices)).toBeNull();
  });
});

describe('the value chart (server-room-overheat at 400 px)', () => {
  const chart = value(overheat);

  it('runs the time axis to 120 s, numbered every 30 s with parts between', () => {
    expect(chart.axis).toMatchObject({
      left: 12,
      right: 388,
      top: 28,
      bottom: 124,
      maxS: 120,
      majorS: 30,
    });
    const numbered = chart.xTicks.filter((tick) => tick.label !== null);
    expect(numbered.map((tick) => [tick.label, tick.x, tick.anchor])).toEqual([
      ['0', 12, 'start'],
      ['30', 106, 'middle'],
      ['60', 200, 'middle'],
      ['90', 294, 'middle'],
      ['120 s', 388, 'end'],
    ]);
    expect(chart.xTicks.filter((tick) => tick.label === null)).toHaveLength(8);
  });

  it('draws the raise and clear lines of the rule, the raise above the clear', () => {
    expect(chart.raise?.label).toBe('raise 27');
    expect(chart.clear?.label).toBe('clear 25.5');
    expect(chart.raise!.y).toBeLessThan(chart.clear!.y);
    expect(chart.raise!.y).toBeGreaterThan(chart.axis.top);
    expect(chart.clear!.y).toBeLessThan(chart.axis.bottom);
    // The amber part is what lies beyond the raise line: from the top of the plot down to it.
    expect(chart.breach).toEqual({ y: 28, height: chart.raise!.y - 28 });
  });

  it('draws the line through every point and closes the area under it', () => {
    expect(chart.line.startsWith('M12,')).toBe(true);
    expect(chart.line.match(/[ML]/g)).toHaveLength(41);
    expect(chart.area.startsWith(chart.line)).toBe(true);
    expect(chart.area.endsWith('Z')).toBe(true);
  });

  it('puts the flags where the simulator expects the alert and the clear, on the top edge', () => {
    expect(chart.flags.map((flag) => [flag.kind, flag.x, flag.y, flag.severity])).toEqual([
      ['alert', 87.2, 12, 'high'],
      ['clear', 262.7, 12, 'high'],
    ]);
  });

  it('flips the alert label to the right of its dot when the left side would leave the plot', () => {
    const [alert, clear] = chart.flags;
    expect(alert).toMatchObject({ label: 'alert ≈ 24 s', labelAnchor: 'start', labelX: 94.2 });
    expect(clear).toMatchObject({ label: 'clears ≈ 80 s', labelAnchor: 'start', labelX: 269.7 });
  });

  it('keeps the alert label on the left of its dot when there is room, on a wider card', () => {
    const [alert, clear] = value(overheat, 800).flags;
    expect(alert).toMatchObject({ x: 167.2, labelAnchor: 'end', labelX: 160.2 });
    expect(clear).toMatchObject({ x: 529.3, labelAnchor: 'start', labelX: 536.3 });
  });

  it('leaves a label off, rather than over another, when there is no room for it', () => {
    const [alert, clear] = value(overheat, 200).flags;
    expect(alert?.label).toBe('alert ≈ 24 s');
    expect(clear?.label).toBeNull();
  });

  it('tags the highest value above the line, inside the plot', () => {
    expect(chart.tag?.label).toBe('29.2 °C');
    expect(chart.tag!.x).toBeGreaterThan(chart.axis.left);
    expect(chart.tag!.x).toBeLessThan(chart.axis.right);
    // The peak is beyond the raise line, so its tag is above that line.
    expect(chart.tag!.y).toBeLessThan(chart.raise!.y);
    expect(chart.tag!.y).toBeGreaterThan(chart.axis.top);
  });

  it('draws no rule lines when the signal has no rule', () => {
    const noRules: RulesView = { available: true, reason: null, items: [] };
    const bare = buildScenarioChart({ item: overheat, rules: noRules, devices, width: 400 });
    expect(bare).toMatchObject({ kind: 'value', raise: null, clear: null, breach: null });
  });

  it('marks a clear that may come later, and draws no clear flag when none is known', () => {
    const expected = overheat.expected as Extract<Expected, { available: true }>;
    const uncertain = {
      ...overheat,
      expected: {
        ...expected,
        alerts: [{ ...expected.alerts[0]!, clearsUncertain: true }],
      },
    };
    expect(value(uncertain).flags[1]?.uncertain).toBe(true);
    const unknown = {
      ...overheat,
      expected: { ...expected, alerts: [{ ...expected.alerts[0]!, clearsAtS: null }] },
    };
    expect(value(unknown).flags.map((flag) => flag.kind)).toEqual(['alert']);
  });
});

describe('nothing honest to draw', () => {
  it('draws nothing when the rules could not be read', () => {
    const unavailable = { ...overheat, expected: { available: false as const, reason: 'x' } };
    expect(buildScenarioChart({ item: unavailable, rules, devices, width: 400 })).toBeNull();
    const lanesUnavailable = { ...afternoon, expected: { available: false as const, reason: 'x' } };
    expect(buildScenarioChart({ item: lanesUnavailable, rules, devices, width: 400 })).toBeNull();
  });

  it('draws nothing for a one-signal scenario the simulator sent no series for', () => {
    const expected = overheat.expected as Extract<Expected, { available: true }>;
    const bare = { ...overheat, expected: { ...expected, series: [] } };
    expect(buildScenarioChart({ item: bare, rules, devices, width: 400 })).toBeNull();
  });

  it('keeps a width no smaller than 200 px', () => {
    expect(value(overheat, 50).width).toBe(200);
  });
});

describe('the lane chart (bad-afternoon at 400 px)', () => {
  const chart = lanes(afternoon);

  it('draws one lane per device in the order their anomalies start, labelled with the device code', () => {
    expect(chart.lanes.map((lane) => [lane.label, lane.shape, lane.title])).toEqual([
      ['HUB', 'hexagon', 'hub-power-01 power_kw'],
      ['DC·1', 'rounded-square', 'dc-env-01 temperature_c'],
      ['LHA', 'circle', 'lha-air-01 temperature_c'],
    ]);
    expect(chart.lanes.map((lane) => lane.y)).toEqual([6, 36, 66]);
    expect(chart.more).toBeNull();
  });

  it('sizes the picture from its lanes, with the axis to 120 s', () => {
    expect(chart.axis).toMatchObject({ left: 56, right: 388, top: 6, bottom: 96, maxS: 120 });
    expect(chart.height).toBe(122);
  });

  it('draws a block for each anomaly with its value inside', () => {
    const hub = chart.lanes[0]!.blocks[0]!;
    expect(hub).toMatchObject({ x: 83.7, width: 152.1, label: '190 kW', shape: 'step' });
    expect(chart.lanes[1]!.blocks[0]!.label).toBe('29.2 °C');
  });

  it('puts the alert and the clear on the lane that raises them, and none on a quiet lane', () => {
    expect(chart.lanes[0]!.alerts).toEqual([
      {
        severity: 'low',
        openX: 89.2,
        clearX: 238.6,
        uncertain: true,
        title: 'Power draw above contracted capacity',
      },
    ]);
    expect(chart.lanes[1]!.alerts[0]).toMatchObject({
      severity: 'high',
      openX: 150.1,
      clearX: 305,
    });
    expect(chart.lanes[2]!.alerts).toEqual([]);
  });

  it('leaves a value out of a block too narrow to hold it', () => {
    const [first] = afternoon.anomalies as [Anomaly];
    const narrow = {
      ...afternoon,
      anomalies: [{ ...first, duration: 2 }, ...afternoon.anomalies.slice(1)],
    };
    expect(lanes(narrow).lanes[0]!.blocks[0]!.label).toBeNull();
  });

  it('draws four lanes at most and says what it left out', () => {
    const [first] = afternoon.anomalies as [Anomaly];
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...first,
      deviceId: `extra-${i}`,
      startAt: i * 10,
    }));
    const six = lanes({ ...afternoon, anomalies: many });
    expect(LANE_LIMIT).toBe(4);
    expect(six.lanes).toHaveLength(4);
    expect(six.more?.text).toBe('+ 2 more devices, 2 anomalies');
    // Four lanes of 30 px from 6, and a line for the rest, then the axis.
    expect(six.height).toBe(6 + 4 * 30 + 20 + 26);
    expect(six.more?.y).toBe(128);
  });

  it('counts a lane left out of a device that is drawn as an anomaly, not a device', () => {
    const [first] = afternoon.anomalies as [Anomaly];
    const anomalies: Anomaly[] = [
      ...['a', 'b', 'c', 'd'].map((id, i) => ({ ...first, deviceId: id, startAt: i * 10 })),
      { ...first, deviceId: 'a', metric: 'humidity_pct', startAt: 90 },
    ];
    const chart5 = lanes({ ...afternoon, anomalies });
    expect(chart5.more?.text).toBe('+ 1 more anomaly');
  });

  it('adds the metric to the label of a device that has more than one lane', () => {
    const [first] = overheat.anomalies as [Anomaly];
    const two = {
      ...overheat,
      anomalies: [first, { ...first, metric: 'humidity_pct' as const, startAt: 30 }],
    };
    expect(lanes(two).lanes.map((lane) => lane.label)).toEqual(['DC·1 Temp', 'DC·1 Humidity']);
  });

  it('shows a device the registry does not have by its id', () => {
    const [first] = afternoon.anomalies as [Anomaly];
    const unknown = { ...afternoon, anomalies: [first, { ...first, deviceId: 'ghost-01' }] };
    expect(lanes(unknown).lanes.map((lane) => lane.label)).toContain('ghost-01');
  });
});

describe('playheadOf', () => {
  const { axis } = value(overheat);

  it('puts the playhead where the scenario has got to and tints what has been played', () => {
    expect(playheadOf(axis, 41)).toEqual({ x: 140.5, playedWidth: 128.5, label: '41 s' });
  });

  it('keeps the playhead on the picture', () => {
    expect(playheadOf(axis, 500)).toEqual({ x: 388, playedWidth: 376, label: '120 s' });
    expect(playheadOf(axis, -3)).toEqual({ x: 12, playedWidth: 0, label: '0 s' });
  });
});

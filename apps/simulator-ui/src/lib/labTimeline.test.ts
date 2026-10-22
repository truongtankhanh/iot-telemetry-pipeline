import { describe, expect, it } from 'vitest';
import type {
  Anomaly,
  DeviceInfo,
  Expected,
  ExpectedAlert,
  RulesView,
  ScenarioItem,
  ScenarioRunView,
} from '../api/types';
import { barProgress, buildDock, CUSTOM_PICK, type DockInput, LANE_MAX } from './labTimeline';
import { xOf } from './scenarioChart';

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

const device = (id: string, zone = 'BLD-DC'): DeviceInfo => ({
  id,
  kind: 'server_room',
  zoneCode: zone,
  metrics: ['temperature_c', 'humidity_pct'],
});

const anomaly = (change: Partial<Anomaly> = {}): Anomaly => ({
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 20,
  duration: 60,
  ...change,
});

const alert = (deviceId: string, opensAtS: number, clearsAtS: number | null): ExpectedAlert => ({
  ruleId: 'server-room-hot',
  title: 'Server room temperature high',
  severity: 'high',
  deviceId,
  metric: 'temperature_c',
  opensAtS,
  opensMargin: false,
  clearsAtS,
  clearsUncertain: false,
});

/** 22.5 outside the fault and 29.2 inside it, every 2 s. */
const series = (deviceId: string, startAt = 20, duration = 60, horizonS = 80) => ({
  deviceId,
  metric: 'temperature_c' as const,
  stepS: 2,
  points: Array.from({ length: horizonS / 2 + 1 }, (_, i) =>
    i * 2 >= startAt && i * 2 < startAt + duration ? 29.2 : 22.5,
  ),
});

const available = (alerts: ExpectedAlert[], lanes = [series('dc-env-01')]): Expected => ({
  available: true,
  intervalS: 2,
  horizonS: 80,
  alerts,
  quiet: [],
  series: lanes,
});

const base = (change: Partial<DockInput> = {}): DockInput => ({
  anomalies: [anomaly()],
  pending: [],
  expected: available([alert('dc-env-01', 24, 80)]),
  devices: [device('dc-env-01')],
  rules,
  width: 1000,
  grouped: false,
  elapsedS: null,
  ...change,
});

describe('buildDock: one fault', () => {
  const dock = buildDock(base());

  it('has a lane for the device with the fault as a block between its start and its end', () => {
    expect(dock.lanes).toHaveLength(1);
    const lane = dock.lanes[0]!;
    expect([lane.kind, lane.label, lane.sub]).toEqual(['device', 'dc-env-01', 'temperature_c']);
    const [block] = lane.blocks;
    expect(block).toMatchObject({ startAt: 20, endAt: 80, value: 29.2, pending: false });
    expect(block!.x).toBe(xOf(dock.axis, 20));
    expect(block!.width).toBeGreaterThan(100);
    expect(block!.label).toBe('29.2 °C');
  });

  it('draws the value from the simulator, against the raise line of the rule', () => {
    const curve = dock.lanes[0]!.curve!;
    expect(curve.points.split(' ')).toHaveLength(41);
    expect(curve.raiseLabel).toBe('raise 27');
    expect(curve.raiseY).not.toBeNull();
    const lane = dock.lanes[0]!;
    expect(curve.raiseY!).toBeGreaterThan(lane.y);
    expect(curve.raiseY!).toBeLessThan(lane.y + lane.height);
  });

  it('draws the window in which the alert is expected, from the simulator, and says it', () => {
    expect(dock.alerts?.label).toBe('server-room-hot · high · raised ≈ 24 s');
    expect(dock.alerts?.summary).toBeNull();
    expect(dock.alerts?.window.x).toBe(xOf(dock.axis, 24));
    expect(dock.alerts?.dots.map((d) => d.kind)).toEqual(['raise', 'clear']);
    expect(dock.alertsNote).toBeNull();
  });

  it('reaches to the end of the fault, has a ruler, and a sentence for a screen reader', () => {
    expect(dock.horizonS).toBe(80);
    expect(dock.ticks.length).toBeGreaterThan(3);
    expect(dock.ticks[0]).toMatchObject({ x: dock.axis.left, label: '0', anchor: 'start' });
    expect(dock.description).toContain('1 anomaly on 1 device');
    expect(dock.description).toContain('server-room-hot · high · raised ≈ 24 s');
  });

  it('has no playhead until it is given a time, and puts it at the time it is given', () => {
    expect(dock.playhead).toBeNull();
    const running = buildDock(base({ elapsedS: 41 }));
    expect(running.playhead?.label).toBe('41 s');
    expect(running.playhead!.x).toBe(xOf(running.axis, 41));
  });

  it('never draws narrower than a picture can be read', () => {
    expect(buildDock(base({ width: 100 })).width).toBe(320);
  });
});

describe('buildDock: the rest of a timeline', () => {
  it('is empty for no faults, and asks for the alerts while the simulator has not answered', () => {
    const dock = buildDock(base({ anomalies: [], expected: null }));
    expect(dock.lanes).toEqual([]);
    expect(dock.horizonS).toBe(30);
    expect(dock.alerts).toBeNull();
    expect(dock.alertsNote).toBe('Working out the alerts…');
    expect(dock.description).toBe('The timeline is empty.');
  });

  it('draws the fault being configured as an outline in the lane it would join', () => {
    const dock = buildDock(base({ pending: [anomaly({ startAt: 100, duration: 20 })] }));
    expect(dock.lanes).toHaveLength(1);
    expect(dock.lanes[0]!.blocks.map((b) => b.pending)).toEqual([false, true]);
    expect(dock.lanes[0]!.blocks[1]!.title).toContain('(not added yet)');
    expect(dock.horizonS).toBe(120);
  });

  it('makes a lane for each device and metric', () => {
    const dock = buildDock(
      base({ anomalies: [anomaly(), anomaly({ metric: 'humidity_pct', value: 70 })] }),
    );
    expect(dock.lanes.map((l) => l.sub)).toEqual(['temperature_c', 'humidity_pct']);
  });

  it('says why there is no alerts lane when the rules cannot be used or raise nothing', () => {
    const off = buildDock(
      base({ expected: { available: false, reason: 'cannot read rules.json' } }),
    );
    expect(off.alerts).toBeNull();
    expect(off.alertsNote).toBe('Expected alerts are not available: cannot read rules.json');
    const quiet = buildDock(base({ expected: available([]) }));
    expect(quiet.alertsNote).toBe('The rules should raise no alert for this timeline.');
  });

  it('draws no curve without the simulator’s series', () => {
    const dock = buildDock(base({ expected: available([alert('dc-env-01', 24, 80)], []) }));
    expect(dock.lanes[0]!.curve).toBeNull();
  });

  it('stops at a number of lanes a picture can hold', () => {
    const devices = Array.from({ length: 70 }, (_, i) => device(`d${i}`));
    const dock = buildDock(
      base({
        anomalies: devices.map((d) => anomaly({ deviceId: d.id })),
        devices,
        expected: null,
      }),
    );
    expect(dock.lanes).toHaveLength(LANE_MAX);
  });
});

describe('buildDock: grouped by zone (frame 19)', () => {
  const zones = ['A', 'B', 'C'];
  const devices = Array.from({ length: 12 }, (_, i) =>
    device(`d${String(i).padStart(2, '0')}`, zones[i < 6 ? 0 : i < 9 ? 1 : 2]),
  );
  const anomalies = devices.map((d, i) =>
    anomaly({ deviceId: d.id, startAt: 20 + 2 * i, duration: 70 }),
  );
  const alerts = devices.map((d, i) => alert(d.id, 24 + 2 * i, 94 + 2 * i));
  const dock = buildDock(
    base({
      anomalies,
      devices,
      grouped: true,
      expected: available(alerts, []),
    }),
  );

  it('draws one lane for each zone, with a thin bar for each device', () => {
    expect(dock.lanes.map((l) => [l.kind, l.label, l.bars.length])).toEqual([
      ['group', 'A', 6],
      ['group', 'B', 3],
      ['group', 'C', 3],
    ]);
    expect(dock.lanes[0]!.sub).toBe('6 devices · temperature_c');
    expect(dock.lanes.every((l) => l.blocks.length === 0 && l.curve === null)).toBe(true);
  });

  it('keeps every bar inside its lane, offset by the stagger, and stacked without leaving the lane', () => {
    for (const lane of dock.lanes) {
      const ys = lane.bars.map((b) => b.y);
      expect(new Set(ys).size).toBe(ys.length);
      for (const bar of lane.bars) {
        expect(bar.y).toBeGreaterThanOrEqual(lane.y);
        expect(bar.y + bar.height).toBeLessThanOrEqual(lane.y + lane.height);
      }
    }
    const xs = dock.lanes[0]!.bars.map((b) => b.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[1]! - xs[0]!).toBeGreaterThan(0);
  });

  it('says the span of a zone at the end of its bars', () => {
    expect(dock.lanes[0]!.span?.text).toBe('20–100 s');
    expect(dock.lanes[1]!.span?.text).toBe('32–106 s');
  });

  it('draws one window for the alerts with a dot for each, and the range of their times', () => {
    expect(dock.alerts?.label).toBe('up to 12 alerts · high');
    expect(dock.alerts?.summary).toBe('raised 24–46 s · clear 94–116 s');
    expect(dock.alerts?.dots).toHaveLength(24);
    expect(dock.description).toContain('12 anomalies on 12 devices in 3 groups');
  });

  it('says there is no clear when the simulator found none', () => {
    const open = buildDock(
      base({
        anomalies: anomalies.slice(0, 2),
        devices,
        grouped: true,
        expected: available([alert('d00', 24, null), alert('d01', 26, null)], []),
      }),
    );
    expect(open.alerts?.summary).toBe('raised 24–26 s · no clear found');
  });
});

describe('buildDock: what the timeline editor asks for', () => {
  it('carries the id of each fault on its block and marks the selected one, and only when ids are given', () => {
    const two = [anomaly(), anomaly({ metric: 'humidity_pct', value: 70 })];
    const dock = buildDock(
      base({
        anomalies: two,
        pending: [anomaly({ deviceId: 'dc-env-01', startAt: 100, duration: 5 })],
        ids: ['x1', 'x2'],
        selectedId: 'x2',
        expected: null,
      }),
    );
    const blocks = dock.lanes.flatMap((lane) => lane.blocks);
    expect(blocks.map((b) => [b.id, b.selected])).toEqual([
      ['x1', false],
      [undefined, undefined], // the fault being configured has no id
      ['x2', true],
    ]);

    const plain = buildDock(base({ anomalies: two, expected: null }));
    for (const block of plain.lanes.flatMap((lane) => lane.blocks)) {
      expect('id' in block).toBe(false);
      expect('selected' in block).toBe(false);
    }
  });

  it('spans the window it is given and not what the faults need', () => {
    expect(buildDock(base({ windowS: 120 })).axis.maxS).toBe(120);
    expect(buildDock(base({ windowS: 300 })).axis.maxS).toBe(300);
    expect(buildDock(base({ windowS: 180 })).horizonS).toBe(180);
    expect(buildDock(base()).axis.maxS).toBe(90); // 80 s of faults and alerts, numbered every 30 s
  });

  it('makes a device lane taller on request and leaves a group lane alone', () => {
    expect(buildDock(base({ laneHeight: 64 })).lanes[0]!.height).toBe(64);
    expect(buildDock(base()).lanes[0]!.height).toBe(48);
  });

  it('marks the part of the curve that is inside a fault, only when asked', () => {
    const dock = buildDock(base({ markInside: true }));
    const curve = dock.lanes[0]!.curve!;
    expect(curve.inside).toHaveLength(1);
    const xs = curve.inside![0]!.split(' ').map((p) => Number(p.split(',')[0]));
    expect(xs[0]).toBe(xOf(dock.axis, 20));
    expect(xs.at(-1)).toBe(xOf(dock.axis, 80));
    expect('inside' in buildDock(base()).lanes[0]!.curve!).toBe(false);
  });

  describe('opening a zone out into its devices', () => {
    const zones = ['A', 'B', 'C'];
    const devices = Array.from({ length: 12 }, (_, i) =>
      device(`d${String(i).padStart(2, '0')}`, zones[i < 6 ? 0 : i < 9 ? 1 : 2]),
    );
    const anomalies = devices.map((d, i) =>
      anomaly({ deviceId: d.id, startAt: 20 + 2 * i, duration: 70 }),
    );
    const grouped = (change: Partial<DockInput> = {}) =>
      buildDock(base({ anomalies, devices, grouped: true, expected: null, ...change }));

    it('follows an open zone’s group lane with a lane for each of its devices, in order', () => {
      const dock = grouped({ expanded: new Set(['B']) });
      expect(dock.lanes.map((l) => [l.kind, l.label, l.zone])).toEqual([
        ['group', 'A', 'A'],
        ['group', 'B', 'B'],
        ['device', 'd06', 'B'],
        ['device', 'd07', 'B'],
        ['device', 'd08', 'B'],
        ['group', 'C', 'C'],
      ]);
      expect(dock.lanes.map((l) => l.expanded)).toEqual([
        false,
        true,
        undefined,
        undefined,
        undefined,
        false,
      ]);
      expect(dock.lanes.filter((l) => l.kind === 'group').every((l) => l.expandable)).toBe(true);
      expect(dock.lanes[2]!.blocks).toHaveLength(1);
      expect(dock.lanes[2]!.bars).toEqual([]);
    });

    it('stacks the lanes, whatever their heights', () => {
      const dock = grouped({ expanded: new Set(['A', 'C']) });
      for (const [i, lane] of dock.lanes.entries()) {
        if (i === 0) continue;
        expect(lane.y).toBe(dock.lanes[i - 1]!.y + dock.lanes[i - 1]!.height);
      }
      const last = dock.lanes.at(-1)!;
      expect(dock.height).toBeGreaterThan(last.y + last.height);
    });

    it('says nothing about opening when it is not asked, and draws the groups as before', () => {
      const dock = grouped();
      expect(dock.lanes.map((l) => [l.kind, l.label])).toEqual([
        ['group', 'A'],
        ['group', 'B'],
        ['group', 'C'],
      ]);
      expect(dock.lanes.some((l) => 'expandable' in l)).toBe(false);
    });
  });

  describe('each alert on a row of its own', () => {
    const two = available(
      [alert('dc-env-02', 30, null), alert('dc-env-01', 24, 80)],
      [series('dc-env-01')],
    );

    it('lists the alerts in the order they open, with where they raise and clear', () => {
      const dock = buildDock(base({ alertRows: true, expected: two }));
      const rows = dock.alerts!.rows!;
      expect(rows.map((r) => [r.deviceId, r.raiseText, r.clearText, r.openToEnd])).toEqual([
        ['dc-env-01', '24 s', '80 s', false],
        ['dc-env-02', '30 s', null, true],
      ]);
      expect(rows[0]!.raiseX).toBe(xOf(dock.axis, 24));
      expect(rows[0]!.clearX).toBe(xOf(dock.axis, 80));
      expect(rows[1]!.clearX).toBeNull();
      expect(rows[1]!.y).toBe(rows[0]!.y + 30);
    });

    it('makes the lane tall enough for its rows, and the picture with it', () => {
      const rows = buildDock(base({ alertRows: true, expected: two }));
      const window = buildDock(base({ expected: two }));
      expect(rows.alerts!.height).toBe(2 * 30 + 12);
      expect(window.alerts!.height).toBe(52);
      expect(rows.height - window.height).toBe(2 * 30 + 12 - 52);
      expect(window.alerts!.rows).toBeUndefined();
    });

    it('keeps an alert that falls after the picture inside it and open to the edge', () => {
      const dock = buildDock(
        base({
          alertRows: true,
          windowS: 30,
          anomalies: [anomaly({ startAt: 0, duration: 10 })],
          expected: available([alert('dc-env-01', 60, 90)]),
        }),
      );
      const [row] = dock.alerts!.rows!;
      expect(row).toMatchObject({ beyond: true, clearX: null, openToEnd: true });
      expect(row!.raiseX).toBe(dock.axis.right);
    });
  });
});

describe('barProgress', () => {
  const item = { name: 'overheat', lengthS: 80 } as unknown as ScenarioItem;
  const run: ScenarioRunView = {
    id: 'run-1',
    scenario: 'overheat',
    startedAt: '2026-10-21T09:14:00.000Z',
    offsetS: 59,
    endsAtS: 139,
    anomalyIds: ['a1'],
    startedDevices: [],
  };
  const live = (anomalies: { id: string; anomaly: Anomaly }[], elapsedS = 100) => ({
    elapsedS,
    nowMs: 1_000,
    running: true,
    simulated: true,
    anomalies,
  });
  const entry = (id: string, startAt: number, duration = 60) => ({
    id,
    anomaly: anomaly({ startAt, duration }),
  });

  it('follows a scenario that is playing, on its own clock', () => {
    const progress = barProgress({
      pick: 'overheat',
      item,
      runs: [run],
      engine: live([entry('a1', 79, 60)]),
      now: 5_000,
      draftS: 0,
      injectedBaseS: null,
    });
    expect(progress).toMatchObject({ elapsedS: 41, totalS: 80, note: null, aligned: true });
    expect(progress.fraction).toBeCloseTo(41 / 80, 5);
  });

  it('says a scenario that is not running is not running, and still gives its length', () => {
    const progress = barProgress({
      pick: 'overheat',
      item,
      runs: [],
      engine: live([]),
      now: 0,
      draftS: 0,
      injectedBaseS: null,
    });
    expect(progress).toEqual({
      elapsedS: null,
      totalS: 80,
      fraction: 0,
      note: 'Not running',
      aligned: false,
    });
  });

  it('measures a draft that was injected from the moment it was, so the playhead is on the dock’s axis', () => {
    const engine = live([entry('x1', 110), entry('x2', 112)], 130);
    const progress = barProgress({
      pick: CUSTOM_PICK,
      item: undefined,
      runs: [],
      engine,
      now: 0,
      draftS: 72,
      injectedBaseS: 100,
    });
    expect(progress).toMatchObject({ elapsedS: 30, totalS: 72, note: null, aligned: true });
  });

  it('measures the faults of the engine that no run owns from the first one, when it was not injected here', () => {
    const progress = barProgress({
      pick: CUSTOM_PICK,
      item: undefined,
      runs: [{ ...run, anomalyIds: ['x1'] }],
      engine: live([entry('x1', 90), entry('x2', 110), entry('x3', 112)], 130),
      now: 0,
      draftS: 0,
      injectedBaseS: null,
    });
    expect(progress).toMatchObject({ elapsedS: 20, totalS: 62, aligned: false });
  });

  it('says a draft is not injected yet, and has nothing to measure without one', () => {
    const waiting = barProgress({
      pick: CUSTOM_PICK,
      item: undefined,
      runs: [],
      engine: live([]),
      now: 0,
      draftS: 90,
      injectedBaseS: null,
    });
    expect(waiting).toEqual({
      elapsedS: null,
      totalS: 90,
      fraction: 0,
      note: 'Not injected yet',
      aligned: false,
    });
    const empty = barProgress({
      pick: CUSTOM_PICK,
      item: undefined,
      runs: [],
      engine: live([]),
      now: 0,
      draftS: 0,
      injectedBaseS: null,
    });
    expect(empty).toEqual({
      elapsedS: null,
      totalS: null,
      fraction: 0,
      note: null,
      aligned: false,
    });
  });

  it('adds the time since the snapshot on the wall clock, and not on the simulated one', () => {
    const wall = { ...live([entry('x1', 90)], 100), simulated: false, nowMs: 0 };
    const progress = barProgress({
      pick: CUSTOM_PICK,
      item: undefined,
      runs: [],
      engine: wall,
      now: 5_000,
      draftS: 0,
      injectedBaseS: null,
    });
    expect(progress.elapsedS).toBe(15);
  });
});

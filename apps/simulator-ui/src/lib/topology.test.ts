import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { StateView } from '../api/types';
import type { Sample } from '../state/history';
import { buildFleetRows } from './fleetRows';
import { derivePipeline } from './pipeline';
import {
  buildTopology,
  DEVICE_NODE_LIMIT,
  type DeviceNodeData,
  type EdgeState,
  type Grouping,
  isProblem,
  type Selection,
  tierOf,
  type TopoEdge,
  type TopoNode,
  type Topology,
  type ZoneNodeData,
  ZONE_NODE_LIMIT,
  ZONE_PREVIEW,
} from './topology';
import { STAGE_BOXES } from './topologyLayout';

const NOW = Date.parse('2026-10-20T09:14:32.000Z');

interface Options {
  series?: Record<string, number>;
  search?: string;
  group?: Grouping | null;
  problemsOnly?: boolean;
  expanded?: string[];
  selection?: Selection | null;
  link?: 'live' | 'lost';
  change?: (view: StateView) => void;
}

/** A view of `count` indoor-air devices spread over `zones` zones, all running. */
function crowd(count: number, zones: number): StateView {
  const view = structuredClone(fixture);
  view.devices = Array.from({ length: count }, (_, i) => ({
    id: `dev-${String(i + 1).padStart(3, '0')}`,
    kind: 'indoor_air',
    zoneCode: `Z-${String((i % zones) + 1).padStart(2, '0')}`,
    metrics: ['co2_ppm' as const],
    name: `Device ${i + 1}`,
  }));
  view.engine.devices = view.devices.map((d) => ({
    id: d.id,
    state: 'running' as const,
    intervalMs: 2000,
    seq: 1,
    holds: {},
  }));
  view.engine.anomalies = [];
  return view;
}

function topology(view: StateView, options: Options = {}): Topology {
  options.change?.(view);
  // `series` maps a device id to the CO2 or temperature it last reported; the rest is silent in the history.
  const seriesOf = (deviceId: string, metric: string): Sample[] => {
    const value = options.series?.[deviceId];
    if (value === undefined) return [];
    if (metric !== 'co2_ppm' && metric !== 'temperature_c') return [];
    return [{ t: NOW - 1000, v: value }];
  };
  const rows = buildFleetRows({ view, now: NOW, seriesOf, lastSeenOf: () => null });
  const stages = derivePipeline({
    view,
    link: options.link ?? 'live',
    lastAlertSink: null,
    rows,
    seriesOf,
    rates: { storedPerSecond: null, lagSeconds: null },
    publishRate: 2,
  });
  return buildTopology({
    rows,
    stages,
    search: options.search ?? '',
    group: options.group ?? null,
    problemsOnly: options.problemsOnly ?? false,
    expanded: new Set(options.expanded ?? []),
    selection: options.selection ?? null,
    link: options.link ?? 'live',
  });
}

/** The campus of the frames: six devices in five zones, dc-env-01 beyond its raise line, hub-power-01 paused. */
const campus = (options: Options = {}) =>
  topology(structuredClone(fixture), { series: { 'dc-env-01': 29.3 }, ...options });

const ofType = (t: Topology, type: TopoNode['type']) => t.nodes.filter((n) => n.type === type);
const node = (t: Topology, id: string) => t.nodes.find((n) => n.id === id);
const zoneData = (t: Topology, code: string) => node(t, `zone:${code}`)?.data as ZoneNodeData;
const deviceData = (t: Topology, id: string) => node(t, `device:${id}`)?.data as DeviceNodeData;
const edge = (t: Topology, id: string) => t.edges.find((e) => e.id === id) as TopoEdge;
const states = (t: Topology): Record<string, EdgeState> =>
  Object.fromEntries(t.edges.map((e) => [e.id, e.state]));

describe('tierOf', () => {
  it('follows the brief: 12 devices and under, 60 and under, above', () => {
    expect([1, 12].map(tierOf)).toEqual(['devices', 'devices']);
    expect([13, 60].map(tierOf)).toEqual(['zones', 'zones']);
    expect([61, 500].map(tierOf)).toEqual(['counts', 'counts']);
    expect(DEVICE_NODE_LIMIT).toBe(12);
    expect(ZONE_NODE_LIMIT).toBe(60);
  });
});

describe('isProblem', () => {
  it('is everything but healthy: an anomaly and a dark device both need a look', () => {
    expect(isProblem('healthy')).toBe(false);
    expect(['anomaly', 'down', 'stale'].every((s) => isProblem(s as 'anomaly'))).toBe(true);
  });
});

describe('up to 12 devices: every device is a node', () => {
  const t = campus();

  it('has a node for each zone, device and stage, and says what the campus is', () => {
    expect(t.tier).toBe('devices');
    expect(t.grouping).toBe('all');
    expect(ofType(t, 'zone')).toHaveLength(5);
    expect(ofType(t, 'device')).toHaveLength(6);
    expect(ofType(t, 'stage')).toHaveLength(7);
    expect(t.summary).toBe('6 devices · 5 zones · 2 problems');
    expect(t.problems).toBe(2);
    expect(t.matches).toBe(6);
  });

  it('locks the chevron of a zone that is open only because every device is shown', () => {
    expect(ofType(t, 'zone').every((n) => (n.data as ZoneNodeData).locked)).toBe(true);
  });

  it('has no "+ n more" at this size', () => {
    expect(ofType(t, 'zone').every((n) => (n.data as ZoneNodeData).more === 0)).toBe(true);
  });

  it('puts each parent before its children, as React Flow requires', () => {
    const seen = new Set<string>();
    for (const n of t.nodes) {
      if (n.parentId !== undefined) expect(seen.has(n.parentId)).toBe(true);
      seen.add(n.id);
    }
  });

  it('places the zones as frame 04 does and the stages on their fixed boxes', () => {
    expect(node(t, 'zone:BLD-DC')).toMatchObject({ position: { x: 12, y: 8 }, height: 124 });
    expect(node(t, 'zone:BLD-LIB')?.position.y).toBe(144);
    expect(node(t, 'device:dc-env-02')).toMatchObject({
      parentId: 'zone:BLD-DC',
      position: { x: 14, y: 76 },
    });
    expect(node(t, 'stage:ingest')).toMatchObject({
      position: { x: STAGE_BOXES.ingest.x, y: STAGE_BOXES.ingest.y },
      width: STAGE_BOXES.ingest.w,
    });
  });

  it('gives each device its own word, reading and state, and names it for a screen reader', () => {
    expect(deviceData(t, 'dc-env-01')).toMatchObject({
      state: 'anomaly',
      word: 'Anomaly',
      metric: 'temperature_c',
      reading: '29.3 °C',
      selected: false,
      dimmed: false,
    });
    expect(deviceData(t, 'dc-env-01').ariaLabel).toBe(
      'Data center — row A, temperature_c 29.3 °C, anomaly',
    );
    expect(deviceData(t, 'hub-power-01')).toMatchObject({
      state: 'stale',
      word: 'Paused',
      reading: null,
    });
    expect(deviceData(t, 'hub-power-01').ariaLabel).toMatch(/no reading, paused$/);
  });

  it('draws a zone with its count and the worst state of its devices', () => {
    expect(zoneData(t, 'BLD-DC')).toMatchObject({ count: 2, worst: 'anomaly', mode: 'open' });
    expect(zoneData(t, 'BLD-HUB')).toMatchObject({ count: 1, worst: 'stale' });
    expect(zoneData(t, 'BLD-LIB')).toMatchObject({ worst: 'healthy' });
    expect(zoneData(t, 'BLD-DC').ariaLabel).toBe('BLD-DC, 2 devices, anomaly');
  });

  it('describes a single device in the singular', () => {
    const one = topology(crowd(1, 1));
    expect(one.summary).toBe('1 device · 1 zone · 0 problems');
  });
});

describe('the edges', () => {
  const t = campus();

  it('has one per device and six for the pipeline', () => {
    expect(t.edges).toHaveLength(12);
    expect(t.edges.filter((e) => e.hop === null)).toHaveLength(6);
  });

  it('lights a running device, turns an anomaly amber and leaves a paused one dark', () => {
    const s = states(t);
    expect(s['device:dc-env-01>broker']).toBe('warn');
    expect(s['device:dc-env-02>broker']).toBe('flowing');
    expect(s['device:hub-power-01>broker']).toBe('off');
  });

  it('carries the device whose messages draw its dots, and none on a pipeline edge', () => {
    expect(edge(t, 'device:dc-env-02>broker').devices).toEqual(['dc-env-02']);
    expect(edge(t, 'broker>ingest').devices).toEqual([]);
    expect(edge(t, 'broker>ingest').hop).toBe('broker>ingest');
  });

  it('lights the pipeline while readings arrive and an alert is open, then the delivery in green', () => {
    expect(states(t)).toMatchObject({
      'broker>ingest': 'flowing',
      'ingest>rules': 'flowing',
      'ingest>database': 'flowing',
      'rules>alert': 'warn',
      'alert>outbox': 'warn',
      'outbox>commandCenter': 'ok',
    });
  });

  it('draws the alert chain dark when no alert is open: nothing is moving', () => {
    const quiet = topology(structuredClone(fixture), {
      change: (view) => (view.alerts.alerts = []),
    });
    expect(states(quiet)).toMatchObject({
      'broker>ingest': 'flowing',
      'rules>alert': 'off',
      'alert>outbox': 'off',
      'outbox>commandCenter': 'off',
    });
  });

  it('puts the lit edges first, so the budget gives the glow to what matters', () => {
    const order = { warn: 0, bad: 1, ok: 2, flowing: 3, off: 4 } as const;
    const ranks = t.edges.map((e) => order[e.state]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('draws the link into ingest red and dashed when ingest is unreachable, and the rest dark', () => {
    const down = campus({
      change: (view) => {
        view.ingest = {
          ...view.ingest,
          status: 'unreachable',
          database: null,
          broker: null,
          alertSink: null,
        };
      },
    });
    expect(states(down)).toMatchObject({
      'broker>ingest': 'bad',
      'ingest>rules': 'off',
      'ingest>database': 'off',
      'rules>alert': 'off',
      'alert>outbox': 'off',
      'outbox>commandCenter': 'off',
    });
    // devices still publish to the broker
    expect(states(down)['device:dc-env-02>broker']).toBe('flowing');
  });

  it('draws the device links dark when the broker is disconnected', () => {
    const down = campus({ change: (view) => (view.broker.connected = false) });
    expect(down.edges.filter((e) => e.hop === null).every((e) => e.state === 'off')).toBe(true);
    expect(node(down, 'stage:broker')?.data).toMatchObject({
      stage: { state: 'down', word: 'Disconnected' },
    });
  });

  it('draws the delivery red when the outbox failed', () => {
    const failed = campus({
      change: (view) => {
        const alert = view.alerts.alerts[0];
        if (alert !== undefined)
          Object.assign(alert, { deliveryStatus: 'failed', externalRef: null });
      },
    });
    expect(states(failed)).toMatchObject({ 'alert>outbox': 'bad', 'outbox>commandCenter': 'bad' });
  });
});

describe('grouping', () => {
  it("collapses each zone to one node that carries its devices' edge, wider for more devices", () => {
    const t = campus({ group: 'zone' });
    expect(t.grouping).toBe('zone');
    expect(ofType(t, 'device')).toHaveLength(0);
    expect(zoneData(t, 'BLD-DC')).toMatchObject({ mode: 'closed', count: 2, worst: 'anomaly' });
    expect(t.edges.filter((e) => e.hop === null)).toHaveLength(5);
    expect(edge(t, 'zone:BLD-DC>broker')).toMatchObject({
      state: 'warn',
      weight: 2,
      devices: ['dc-env-01', 'dc-env-02'],
    });
    // a zone with only a paused device has nothing to light and no device to draw dots for
    expect(edge(t, 'zone:BLD-HUB>broker')).toMatchObject({ state: 'off', devices: [] });
  });

  it('opens a zone in place when the viewer asks, and lets the viewer close it again', () => {
    const t = campus({ group: 'zone', expanded: ['BLD-LIB'] });
    expect(zoneData(t, 'BLD-LIB')).toMatchObject({ mode: 'open', locked: false });
    expect(zoneData(t, 'BLD-DC').mode).toBe('closed');
    expect(ofType(t, 'device').map((n) => n.id)).toEqual(['device:lib-air-01']);
    // the zone that opened drew its device's edge, not its own
    expect(t.edges.some((e) => e.id === 'zone:BLD-LIB>broker')).toBe(false);
    expect(t.edges.some((e) => e.id === 'device:lib-air-01>broker')).toBe(true);
  });

  it('opens the zone of the selected device, and of a selected zone', () => {
    const byDevice = campus({ group: 'zone', selection: { type: 'device', id: 'lha-air-01' } });
    // open because it holds the selection, not because the viewer opened it: the chevron cannot close it
    expect(zoneData(byDevice, 'BLD-LHA')).toMatchObject({ mode: 'open', locked: true });
    expect(deviceData(byDevice, 'lha-air-01').selected).toBe(true);

    const byZone = campus({ group: 'zone', selection: { type: 'zone', id: 'BLD-STU' } });
    expect(zoneData(byZone, 'BLD-STU')).toMatchObject({ mode: 'open', selected: true });
  });

  it('marks a selected stage', () => {
    const t = campus({ selection: { type: 'stage', id: 'rules' } });
    expect(node(t, 'stage:rules')?.data).toMatchObject({ selected: true });
    expect(node(t, 'stage:alert')?.data).toMatchObject({ selected: false });
  });
});

describe('_Problems only_ and search', () => {
  it('keeps the devices that need a look and the zones that hold them, and every stage', () => {
    const t = campus({ problemsOnly: true });
    expect(
      ofType(t, 'device')
        .map((n) => (n.data as DeviceNodeData).deviceId)
        .sort(),
    ).toEqual(['dc-env-01', 'hub-power-01']);
    expect(
      ofType(t, 'zone')
        .map((n) => (n.data as ZoneNodeData).code)
        .sort(),
    ).toEqual(['BLD-DC', 'BLD-HUB']);
    expect(ofType(t, 'stage')).toHaveLength(7);
    expect(t.matches).toBe(2);
    // the zone still says how many devices it has, not how many are drawn
    expect(zoneData(t, 'BLD-DC').count).toBe(2);
  });

  it('opens the zone of a device that matches the search, even when grouped', () => {
    const t = campus({ group: 'zone', search: 'lib-air' });
    expect(t.matches).toBe(1);
    expect(ofType(t, 'zone').map((n) => (n.data as ZoneNodeData).code)).toEqual(['BLD-LIB']);
    expect(zoneData(t, 'BLD-LIB').mode).toBe('open');
    expect(ofType(t, 'device')).toHaveLength(1);
  });

  it('finds a zone by its code and shows the devices in it', () => {
    const t = campus({ search: 'BLD-DC' });
    expect(t.matches).toBe(2);
    expect(ofType(t, 'device')).toHaveLength(2);
  });

  it('has no zone and no device when nothing matches, and still draws the pipeline', () => {
    const t = campus({ search: 'no such device' });
    expect(t.matches).toBe(0);
    expect(ofType(t, 'zone')).toHaveLength(0);
    expect(ofType(t, 'device')).toHaveLength(0);
    expect(ofType(t, 'stage')).toHaveLength(7);
  });

  it("keeps the selected device's zone in view when a filter would hide it", () => {
    const t = campus({ problemsOnly: true, selection: { type: 'device', id: 'lib-air-01' } });
    expect(zoneData(t, 'BLD-LIB')).toBeDefined();
  });
});

describe('13 to 60 devices: a zone is one node that opens in place', () => {
  // 30 devices in 3 zones of 10; the last device of zone 1 is above its raise line
  const view = () => crowd(30, 3);
  const anomalous = { series: { 'dev-028': 1400 } };

  it('draws one closed node per zone with its count and worst state', () => {
    const t = topology(view(), anomalous);
    expect(t.tier).toBe('zones');
    expect(t.grouping).toBe('zone');
    expect(ofType(t, 'device')).toHaveLength(0);
    expect(ofType(t, 'zone')).toHaveLength(3);
    expect(zoneData(t, 'Z-01')).toMatchObject({ mode: 'closed', count: 10, worst: 'anomaly' });
    expect(zoneData(t, 'Z-02')).toMatchObject({ worst: 'healthy' });
  });

  it('opens to the 6 worst devices and "+ n more", with the problem first', () => {
    const t = topology(view(), { ...anomalous, expanded: ['Z-01'] });
    const shown = ofType(t, 'device').map((n) => (n.data as DeviceNodeData).deviceId);
    expect(shown).toHaveLength(ZONE_PREVIEW);
    expect(shown[0]).toBe('dev-028');
    expect(zoneData(t, 'Z-01')).toMatchObject({ mode: 'open', more: 4, count: 10 });
    expect(node(t, 'zone:Z-01')?.height).toBeGreaterThan(node(t, 'zone:Z-02')?.height ?? 0);
  });

  it('shows a selected device that is not among the first 6', () => {
    const t = topology(view(), {
      expanded: ['Z-01'],
      selection: { type: 'device', id: 'dev-025' },
    });
    const shown = ofType(t, 'device').map((n) => (n.data as DeviceNodeData).deviceId);
    expect(shown).toContain('dev-025');
    expect(zoneData(t, 'Z-01').more).toBe(10 - shown.length);
  });

  it('shows every device when the viewer asks for All devices', () => {
    const t = topology(view(), { group: 'all' });
    expect(t.grouping).toBe('all');
    expect(ofType(t, 'device')).toHaveLength(30);
    expect(ofType(t, 'zone').every((n) => (n.data as ZoneNodeData).more === 0)).toBe(true);
  });

  it('keeps zones in the order of the registry', () => {
    const t = topology(view(), anomalous);
    expect(ofType(t, 'zone').map((n) => (n.data as ZoneNodeData).code)).toEqual([
      'Z-01',
      'Z-02',
      'Z-03',
    ]);
  });
});

describe('more than 60 devices: a zone shows counts only', () => {
  // 80 devices in 8 zones of 10; Z-05 holds an anomaly and Z-07 a paused device
  const view = () => crowd(80, 8);
  const unhealthy = {
    series: { 'dev-005': 1400 },
    change: (v: StateView) => {
      const paused = v.engine.devices.find((d) => d.id === 'dev-007');
      if (paused) paused.state = 'paused';
    },
  };

  it('draws counts only, worst zone first, and never every device', () => {
    const t = topology(view(), unhealthy);
    expect(t.tier).toBe('counts');
    expect(ofType(t, 'device')).toHaveLength(0);
    const codes = ofType(t, 'zone').map((n) => (n.data as ZoneNodeData).code);
    expect(codes.slice(0, 2)).toEqual(['Z-05', 'Z-07']);
    expect(zoneData(t, 'Z-05')).toMatchObject({
      mode: 'counts',
      count: 10,
      worst: 'anomaly',
      counts: { anomaly: 1, healthy: 9, stale: 0, down: 0 },
    });
  });

  it('ignores All devices: 80 nodes is not a picture', () => {
    const t = topology(view(), { ...unhealthy, group: 'all' });
    expect(t.grouping).toBe('zone');
    expect(ofType(t, 'device')).toHaveLength(0);
  });

  it('reaches a device only through search or _Problems only_', () => {
    const problems = topology(view(), { ...unhealthy, problemsOnly: true });
    expect(
      ofType(problems, 'device')
        .map((n) => (n.data as DeviceNodeData).deviceId)
        .sort(),
    ).toEqual(['dev-005', 'dev-007']);
    expect(ofType(problems, 'zone')).toHaveLength(2);

    const found = topology(view(), { search: 'dev-042' });
    expect(ofType(found, 'device').map((n) => n.id)).toEqual(['device:dev-042']);
  });

  it('draws one edge per zone, not per device', () => {
    const t = topology(view(), unhealthy);
    expect(t.edges.filter((e) => e.hop === null)).toHaveLength(8);
    expect(edge(t, 'zone:Z-05>broker')).toMatchObject({ state: 'warn', weight: 10 });
  });
});

describe('when the link to the simulator is lost', () => {
  it('dims the devices and the zones, and the stages with them', () => {
    const t = campus({ link: 'lost' });
    expect(deviceData(t, 'dc-env-01').dimmed).toBe(true);
    expect(zoneData(t, 'BLD-DC').dimmed).toBe(true);
    expect(node(t, 'stage:broker')?.data).toMatchObject({ stage: { dimmed: true } });
  });
});

describe('bounds', () => {
  it('hold the zone column and the stages, to fit the view to', () => {
    const t = campus();
    expect(t.bounds.x).toBe(12);
    expect(t.bounds.y).toBe(8);
    expect(t.bounds.x + t.bounds.w).toBeGreaterThanOrEqual(
      STAGE_BOXES.commandCenter.x + STAGE_BOXES.commandCenter.w,
    );
  });
});

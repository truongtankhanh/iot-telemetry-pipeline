import type {
  Anomaly,
  DeviceInfo,
  EngineSnapshot,
  Expected,
  ExpectedAlert,
  RulesView,
  ScenarioItem,
  ScenarioRunView,
  Severity,
} from '../api/types';
import { chartDomain, linearScale } from './chartMath';
import { type DeviceShape, kindIdentity, metricUnit } from './deviceIdentity';
import { looseAnomalies } from './labFault';
import { rangeOf, rulesFor } from './rules';
import {
  type ChartAxis,
  type ChartTick,
  playheadOf,
  ticksOf,
  timeAxis,
  xOf,
} from './scenarioChart';
import { seconds } from './scenarioExpectation';
import { scenarioElapsedS } from './runClock';

/**
 * The geometry of the Lab's timeline dock (frames 12 and 19), kept out of the component: a ruler, a lane for each
 * device (or for each zone, above 60 devices), the faults as blocks with the value drawn against the rule's raise line,
 * the window in which the alerts are expected, and the playhead. A pure function of the faults and of the simulator's
 * `expected`; no alert time is worked out here. The picture is drawn at its true pixel width so its text stays 13 px
 * or more.
 */

/** The most lanes drawn; a Lab with that many devices in the timeline already groups by zone. */
export const LANE_MAX = 60;

const LEFT = 176;
const RIGHT_MARGIN = 16;
const MIN_WIDTH = 320;
const RULER_HEIGHT = 30;
const DEVICE_LANE = 48;
const GROUP_LANE = 34;
const ALERTS_LANE = 52;
const BOTTOM = 8;
const MIN_HORIZON_S = 30;
const CHAR_PX = 7.4;

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface DockBlock {
  x: number;
  width: number;
  startAt: number;
  endAt: number;
  value: number;
  /** The value inside the block ("29.2 °C"); `null` when it does not fit. */
  label: string | null;
  /** Configured but not added yet: drawn as an outline. */
  pending: boolean;
  title: string;
}

/** A group lane draws one thin bar for each device, stacked, so a zone of many devices stays one row. */
export interface DockBar {
  x: number;
  width: number;
  y: number;
  height: number;
  pending: boolean;
  title: string;
}

export interface DockCurve {
  /** `x,y x,y …` for a polyline: the noise-free value at each step, from the simulator's `expected.series`. */
  points: string;
  /** Where the rule's raise line falls in this lane; `null` when no rule watches the signal or it is off the picture. */
  raiseY: number | null;
  raiseLabel: string | null;
}

export interface DockLane {
  key: string;
  kind: 'device' | 'group';
  /** The device id, or the zone code. */
  label: string;
  /** The metric for a device lane; "6 devices · temperature_c" for a group. */
  sub: string;
  shape: DeviceShape | null;
  y: number;
  height: number;
  blocks: DockBlock[];
  bars: DockBar[];
  curve: DockCurve | null;
  /** "20–90 s" at the end of a group's bars. */
  span: { text: string; x: number } | null;
}

export interface AlertsLane {
  y: number;
  height: number;
  /** One window from the first alert to the last clear. */
  window: { x: number; width: number };
  dots: { x: number; kind: 'raise' | 'clear'; severity: Severity }[];
  label: string;
  /** "raised 24–46 s · clear 80–102 s" for more than one alert. */
  summary: string | null;
}

export interface DockModel {
  width: number;
  height: number;
  horizonS: number;
  axis: ChartAxis;
  ticks: ChartTick[];
  lanes: DockLane[];
  alerts: AlertsLane | null;
  /** Why there is no alerts lane, or what it rests on, in a sentence; `null` when it is drawn. */
  alertsNote: string | null;
  playhead: { x: number; playedWidth: number; label: string } | null;
  /** The sentence for a screen reader. */
  description: string;
}

export interface DockInput {
  /** The timeline's faults, seconds from its start. */
  anomalies: readonly Anomaly[];
  /** The fault being configured, drawn as an outline among them. */
  pending: readonly Anomaly[];
  /** What the simulator says the rules do with all of them; `null` while it is being asked. */
  expected: Expected | null;
  devices: readonly DeviceInfo[];
  rules: RulesView;
  width: number;
  /** One lane for each zone instead of each device (above 60 devices). */
  grouped: boolean;
  /** Seconds into the timeline for the playhead; `null` for none. */
  elapsedS: number | null;
}

interface Placed {
  anomaly: Anomaly;
  pending: boolean;
}

const end = (anomaly: Anomaly) => anomaly.startAt + anomaly.duration;

function blockOf(placed: Placed, axis: ChartAxis): DockBlock {
  const { anomaly, pending } = placed;
  const x = xOf(axis, anomaly.startAt);
  const width = Math.max(2, round1(xOf(axis, end(anomaly)) - x));
  const unit = metricUnit(anomaly.metric);
  const label = `${anomaly.value}${unit === '' ? '' : ` ${unit}`}`;
  return {
    x,
    width,
    startAt: anomaly.startAt,
    endAt: end(anomaly),
    value: anomaly.value,
    label: width >= label.length * CHAR_PX + 12 ? label : null,
    pending,
    title: `${anomaly.deviceId} ${anomaly.metric} ${label} from ${seconds(anomaly.startAt)} for ${seconds(anomaly.duration)}${pending ? ' (not added yet)' : ''}`,
  };
}

function curveOf(
  lane: { deviceId: string; metric: string },
  input: DockInput,
  axis: ChartAxis,
  top: number,
  bottom: number,
): DockCurve | null {
  const { expected } = input;
  if (expected === null || !expected.available) return null;
  const series = expected.series.find(
    (s) => s.deviceId === lane.deviceId && s.metric === lane.metric,
  );
  if (series === undefined || series.points.length === 0) return null;
  const device = input.devices.find((d) => d.id === lane.deviceId);
  const rule =
    device === undefined ? null : (rulesFor(input.rules, device, lane.metric)[0] ?? null);
  const [lo, hi] = chartDomain(
    series.points,
    rule === null ? [] : [rule.raise],
    rangeOf(lane.metric),
  );
  const y = linearScale(lo, hi, bottom, top);
  const points = series.points
    .map((value, i) => `${xOf(axis, i * series.stepS)},${round1(y(value))}`)
    .join(' ');
  const raiseY =
    rule !== null && rule.raise >= lo && rule.raise <= hi ? round1(y(rule.raise)) : null;
  return {
    points,
    raiseY,
    raiseLabel: rule === null || raiseY === null ? null : `raise ${rule.raise}`,
  };
}

function alertsLane(
  alerts: readonly ExpectedAlert[],
  axis: ChartAxis,
  horizonS: number,
  y: number,
): AlertsLane | null {
  if (alerts.length === 0) return null;
  const opens = alerts.map((a) => a.opensAtS);
  const clears = alerts.flatMap((a) => (a.clearsAtS === null ? [] : [a.clearsAtS]));
  const from = Math.min(...opens);
  const to = clears.length > 0 ? Math.max(...clears) : horizonS;
  const x = xOf(axis, from);
  const dots: AlertsLane['dots'] = alerts.flatMap((a) => [
    { x: xOf(axis, a.opensAtS), kind: 'raise' as const, severity: a.severity },
    ...(a.clearsAtS === null
      ? []
      : [{ x: xOf(axis, a.clearsAtS), kind: 'clear' as const, severity: a.severity }]),
  ]);
  const severities = [...new Set(alerts.map((a) => a.severity))].join(', ');
  const only = alerts.length === 1 ? alerts[0]! : null;
  return {
    y,
    height: ALERTS_LANE,
    window: { x, width: Math.max(2, round1(xOf(axis, to) - x)) },
    dots,
    label: only
      ? `${only.ruleId} · ${only.severity} · raised ≈ ${seconds(only.opensAtS)}`
      : `up to ${alerts.length} alerts · ${severities}`,
    summary:
      only === null
        ? `raised ${Math.min(...opens)}–${Math.max(...opens)} s · ${
            clears.length > 0
              ? `clear ${Math.min(...clears)}–${Math.max(...clears)} s`
              : 'no clear found'
          }`
        : null,
  };
}

/** The dock's picture for these faults. */
export function buildDock(input: DockInput): DockModel {
  const width = Math.max(MIN_WIDTH, Math.round(input.width));
  const placed: Placed[] = [
    ...input.anomalies.map((anomaly) => ({ anomaly, pending: false })),
    ...input.pending.map((anomaly) => ({ anomaly, pending: true })),
  ];
  const expectedHorizon = input.expected?.available ? input.expected.horizonS : 0;
  const horizonS = Math.max(MIN_HORIZON_S, expectedHorizon, ...placed.map((p) => end(p.anomaly)));

  // The lanes: one for each device and metric, or one for each zone.
  const zoneOf = (deviceId: string) =>
    input.devices.find((d) => d.id === deviceId)?.zoneCode ?? deviceId;
  const groups = new Map<string, Placed[]>();
  for (const p of placed) {
    const key = input.grouped
      ? zoneOf(p.anomaly.deviceId)
      : `${p.anomaly.deviceId}\u0000${p.anomaly.metric}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  const keys = [...groups.keys()].slice(0, LANE_MAX);

  const laneHeight = input.grouped ? GROUP_LANE : DEVICE_LANE;
  const lanesBottom = RULER_HEIGHT + keys.length * laneHeight;
  const hasAlerts = input.expected?.available === true && input.expected.alerts.length > 0;
  const height = lanesBottom + (hasAlerts ? ALERTS_LANE : 0) + BOTTOM;

  const axis = timeAxis(horizonS, 0, {
    left: LEFT,
    right: width - RIGHT_MARGIN,
    top: RULER_HEIGHT,
    bottom: height,
  });

  const lanes = keys.map((key, row): DockLane => {
    const members = groups.get(key)!;
    const first = members[0]!.anomaly;
    const y = RULER_HEIGHT + row * laneHeight;
    if (!input.grouped) {
      const device = input.devices.find((d) => d.id === first.deviceId);
      return {
        key,
        kind: 'device',
        label: first.deviceId,
        sub: first.metric,
        shape: kindIdentity(device?.kind ?? '').shape,
        y,
        height: laneHeight,
        blocks: members.map((m) => blockOf(m, axis)),
        bars: [],
        curve: curveOf(first, input, axis, y + 8, y + laneHeight - 8),
        span: null,
      };
    }
    const devicesIn = new Set(members.map((m) => m.anomaly.deviceId));
    const metrics = new Set(members.map((m) => m.anomaly.metric));
    const barHeight = Math.max(
      2,
      Math.min(6, Math.floor((laneHeight - 8) / Math.max(1, members.length))),
    );
    const room = laneHeight - 8 - barHeight;
    const step = members.length > 1 ? Math.min(barHeight + 1, room / (members.length - 1)) : 0;
    const bars = members.map((m, i): DockBar => {
      const x = xOf(axis, m.anomaly.startAt);
      return {
        x,
        width: Math.max(2, round1(xOf(axis, end(m.anomaly)) - x)),
        y: round1(y + 4 + i * step),
        height: barHeight,
        pending: m.pending,
        title: `${m.anomaly.deviceId} ${m.anomaly.metric} ${m.anomaly.value} from ${seconds(m.anomaly.startAt)} for ${seconds(m.anomaly.duration)}`,
      };
    });
    const startAll = Math.min(...members.map((m) => m.anomaly.startAt));
    const endAll = Math.max(...members.map((m) => end(m.anomaly)));
    return {
      key,
      kind: 'group',
      label: key,
      sub: `${devicesIn.size} ${devicesIn.size === 1 ? 'device' : 'devices'}${metrics.size === 1 ? ` · ${[...metrics][0]}` : ''}`,
      shape: null,
      y,
      height: laneHeight,
      blocks: [],
      bars,
      curve: null,
      span: { text: `${round1(startAll)}–${round1(endAll)} s`, x: xOf(axis, endAll) + 8 },
    };
  });

  const alerts =
    input.expected?.available === true
      ? alertsLane(input.expected.alerts, axis, horizonS, lanesBottom)
      : null;
  const alertsNote = alerts !== null ? null : alertsNoteOf(input.expected);

  const playhead = input.elapsedS === null ? null : playheadOf(axis, input.elapsedS);
  const devicesCount = new Set(placed.map((p) => p.anomaly.deviceId)).size;
  const description =
    placed.length === 0
      ? 'The timeline is empty.'
      : `Timeline of ${Math.round(axis.maxS)} seconds: ${placed.length} ${placed.length === 1 ? 'anomaly' : 'anomalies'} on ${devicesCount} ${devicesCount === 1 ? 'device' : 'devices'}${input.grouped ? ` in ${keys.length} ${keys.length === 1 ? 'group' : 'groups'}` : ''}.${
          alerts === null
            ? ''
            : ` ${alerts.label}${alerts.summary === null ? '' : `, ${alerts.summary}`}.`
        }`;

  return {
    width,
    height,
    horizonS,
    axis,
    ticks: ticksOf(axis),
    lanes,
    alerts,
    alertsNote,
    playhead,
    description,
  };
}

function alertsNoteOf(expected: Expected | null): string | null {
  if (expected === null) return 'Working out the alerts…';
  if (!expected.available) return `Expected alerts are not available: ${expected.reason}`;
  return expected.alerts.length === 0 ? 'The rules should raise no alert for this timeline.' : null;
}

// ---- The bar: how far along it is ----

export interface BarProgress {
  /** Seconds into what is playing; `null` when nothing is. */
  elapsedS: number | null;
  /** Seconds in all; `null` when there is nothing to measure against. */
  totalS: number | null;
  /** 0 to 1. */
  fraction: number;
  /** "Not running", "Not injected yet"; `null` when it is running. */
  note: string | null;
  /** True when `elapsedS` is on the dock's own time axis, so the playhead can be drawn from it. */
  aligned: boolean;
}

export interface ProgressInput {
  /** `custom` for the draft (and any fault of the engine that no run owns), else a scenario's name. */
  pick: string;
  item: ScenarioItem | undefined;
  runs: readonly ScenarioRunView[];
  engine: Pick<EngineSnapshot, 'elapsedS' | 'nowMs' | 'running' | 'simulated' | 'anomalies'>;
  now: number;
  /** Length of the draft in seconds. */
  draftS: number;
  /** The engine's anomaly clock when the draft was injected, if it was in this window. */
  injectedBaseS: number | null;
}

export const CUSTOM_PICK = 'custom';

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** "Elapsed 41 s / 80 s" for a scenario that is playing, a draft that was injected, or the faults of the engine no run owns. */
export function barProgress(input: ProgressInput): BarProgress {
  const { pick, item, runs, engine, now } = input;
  const none = (totalS: number | null, note: string | null): BarProgress => ({
    elapsedS: null,
    totalS,
    fraction: 0,
    note,
    aligned: false,
  });

  if (pick !== CUSTOM_PICK && item !== undefined) {
    const run = runs.find((r) => r.scenario === item.name);
    if (run === undefined) return none(item.lengthS, 'Not running');
    const elapsedS = scenarioElapsedS(run, engine, now, item.lengthS);
    return {
      elapsedS,
      totalS: item.lengthS,
      fraction: item.lengthS > 0 ? elapsedS / item.lengthS : 0,
      note: null,
      aligned: true,
    };
  }

  const loose = looseAnomalies(engine, runs);
  if (loose.length === 0) {
    return input.draftS > 0 ? none(input.draftS, 'Not injected yet') : none(null, null);
  }
  const sinceSnapshotS =
    engine.running && !engine.simulated ? Math.max(0, (now - engine.nowMs) / 1000) : 0;
  const clock = engine.elapsedS + sinceSnapshotS;
  const first = Math.min(...loose.map((e) => e.anomaly.startAt));
  const last = Math.max(...loose.map((e) => e.anomaly.startAt + e.anomaly.duration));
  const base = input.injectedBaseS ?? first;
  const totalS = input.injectedBaseS === null ? last - first : Math.max(input.draftS, last - base);
  const elapsedS = clamp(clock - base, 0, totalS);
  return {
    elapsedS,
    totalS,
    fraction: totalS > 0 ? elapsedS / totalS : 0,
    note: null,
    aligned: input.injectedBaseS !== null,
  };
}

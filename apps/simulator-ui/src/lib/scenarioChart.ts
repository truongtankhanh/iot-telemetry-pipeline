import type {
  DeviceInfo,
  ExpectedAlert,
  RuleInfo,
  RulesView,
  ScenarioItem,
  Severity,
} from '../api/types';
import { chartDomain, linearScale } from './chartMath';
import {
  type DeviceShape,
  deviceCode,
  kindIdentity,
  metricLabel,
  metricUnit,
} from './deviceIdentity';
import { seconds } from './scenarioExpectation';
import { rangeOf, rulesFor } from './rules';

/**
 * The geometry of the scenario card's chart (frame 03), kept out of the components: where a value, a time, a flag
 * and a block fall on the picture. Pure functions of the `ScenarioItem` the simulator sent; the numbers (the alert, the
 * clear, the value at each tick) are the simulator's `expected` and are never worked out here. The picture is drawn at
 * its true pixel width so its text stays 13 px or more, which is why a label that would not fit or would run into
 * another is left off (the sentence of `chartDescription` and the card's text carry the same numbers).
 */

/** A card draws at most this many lanes of a scenario that moves several signals; the rest are one line of text. */
export const LANE_LIMIT = 4;

const MIN_WIDTH = 200;
const VALUE_HEIGHT = 150;
const VALUE_TOP = 28;
const VALUE_BOTTOM_MARGIN = 26;
/** Room kept above the highest value for its tag, so the tag never sits on the line. */
const TAG_ROOM = 18;
const LANES_LEFT = 56;
const SIDE_MARGIN = 12;
/** The height of one lane of the lane chart, in pixels. */
export const LANE_HEIGHT = 26;
const LANE_GAP = 4;
const LANES_TOP = 6;
const MORE_HEIGHT = 20;
const AXIS_MARGIN = 26;
/** About the width of one character of 13 px text, to decide whether a label fits. */
const CHAR_PX = 7.4;
const FLAG_Y = 12;
const FLAG_GAP = 7;
const MAJOR_STEPS = [30, 60, 120, 300, 600, 900, 1800, 3600];
const MAX_MAJOR_TICKS = 6;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The scales of a picture: seconds from the scenario start on the x axis, inside the plot area. */
export interface ChartAxis {
  maxS: number;
  /** Seconds between the numbered ticks. */
  majorS: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChartTick {
  x: number;
  /** Numbered ticks only; the last one carries the unit ("120 s"). */
  label: string | null;
  anchor: 'start' | 'middle' | 'end';
}

/** Where `t` seconds fall on the x axis. */
export const xOf = (axis: ChartAxis, t: number): number =>
  round1(linearScale(0, axis.maxS, axis.left, axis.right)(t));

/**
 * The time axis: a numbered tick every `majorS` seconds (30, 60, 120… so that there are at most six) and three
 * parts between them. It runs past the end of the picture by `room` (a fraction), which is where a label to the right
 * of the last flag goes.
 */
function timeAxis(
  horizonS: number,
  room: number,
  box: Pick<ChartAxis, 'left' | 'right' | 'top' | 'bottom'>,
): ChartAxis {
  const wanted = Math.max(horizonS * (1 + room), 1);
  const majorS =
    MAJOR_STEPS.find((step) => Math.ceil(wanted / step) <= MAX_MAJOR_TICKS) ??
    MAJOR_STEPS[MAJOR_STEPS.length - 1]!;
  return { ...box, majorS, maxS: Math.max(1, Math.ceil(wanted / majorS)) * majorS };
}

function ticksOf(axis: ChartAxis): ChartTick[] {
  const ticks: ChartTick[] = [];
  const minorS = axis.majorS / 3;
  for (let t = 0; t <= axis.maxS + 1e-9; t += minorS) {
    const major = Math.abs(t % axis.majorS) < 1e-9;
    const last = t >= axis.maxS - 1e-9;
    ticks.push({
      x: xOf(axis, t),
      label: major ? (last ? `${t} s` : String(t)) : null,
      anchor: t === 0 ? 'start' : last ? 'end' : 'middle',
    });
  }
  return ticks;
}

/** One signal (a device and a metric) or several: a value chart for the first, lanes for the second. */
export function chartKind(item: ScenarioItem): 'value' | 'lanes' {
  const signals = new Set(item.anomalies.map((a) => `${a.deviceId}\u0000${a.metric}`));
  return signals.size <= 1 ? 'value' : 'lanes';
}

/** The rule whose raise and clear lines are drawn for a one-signal scenario: the one it raises, else the one that watches the signal. */
export function ruleOf(
  item: ScenarioItem,
  rules: RulesView,
  devices: readonly DeviceInfo[],
): RuleInfo | null {
  const first = item.anomalies[0];
  if (!first || !rules.available) return null;
  const raised = item.expected.available
    ? item.expected.alerts.find((a) => a.deviceId === first.deviceId && a.metric === first.metric)
    : undefined;
  const byId = raised ? rules.items.find((rule) => rule.id === raised.ruleId) : undefined;
  if (byId) return byId;
  const device = devices.find((d) => d.id === first.deviceId);
  return device ? (rulesFor(rules, device, first.metric)[0] ?? null) : null;
}

// ---- Labels that must not run into each other ----

export interface ChartFlag {
  kind: 'alert' | 'clear';
  /** The alert's severity, for the colour and the word of an alert flag; clears are green. */
  severity: Severity;
  x: number;
  y: number;
  /** The words of the flag ("alert ≈ 24 s"), for a tooltip, whether or not there is room to write them beside it. */
  text: string;
  /** The same words beside the dot; `null` when there is no room for them. */
  label: string | null;
  labelX: number;
  labelAnchor: 'start' | 'end';
  /** The clear may come later than shown: drawn dashed. */
  uncertain: boolean;
}

interface FlagInput {
  kind: ChartFlag['kind'];
  severity: Severity;
  x: number;
  text: string;
  uncertain: boolean;
}

/**
 * Puts the flags' labels beside their dots: an alert's to the left of its dot, a clear's to the right, flipped to the
 * other side when the first would leave the plot or run into a label already placed, and left off when neither fits.
 */
function placeFlags(inputs: readonly FlagInput[], axis: ChartAxis): ChartFlag[] {
  const taken: [number, number][] = [];
  const free = (from: number, to: number) =>
    from >= axis.left && to <= axis.right && taken.every(([a, b]) => to <= a || from >= b);

  return [...inputs]
    .sort((a, b) => a.x - b.x)
    .map((input) => {
      const width = input.text.length * CHAR_PX;
      const left = {
        from: input.x - FLAG_GAP - width,
        to: input.x - FLAG_GAP,
        anchor: 'end' as const,
      };
      const right = {
        from: input.x + FLAG_GAP,
        to: input.x + FLAG_GAP + width,
        anchor: 'start' as const,
      };
      const options = input.kind === 'alert' ? [left, right] : [right, left];
      const fit = options.find((option) => free(option.from, option.to));
      if (fit) taken.push([fit.from, fit.to]);
      return {
        kind: input.kind,
        severity: input.severity,
        x: input.x,
        y: FLAG_Y,
        text: input.text,
        label: fit ? input.text : null,
        labelX: fit ? round1(fit.anchor === 'end' ? fit.to : fit.from) : input.x,
        labelAnchor: fit?.anchor ?? 'start',
        uncertain: input.uncertain,
      };
    });
}

function flagInputs(alerts: readonly ExpectedAlert[], axis: ChartAxis): FlagInput[] {
  const inputs: FlagInput[] = [];
  for (const alert of alerts) {
    inputs.push({
      kind: 'alert',
      severity: alert.severity,
      x: xOf(axis, alert.opensAtS),
      text: `alert ≈ ${seconds(alert.opensAtS)}`,
      uncertain: false,
    });
    if (alert.clearsAtS !== null) {
      inputs.push({
        kind: 'clear',
        severity: alert.severity,
        x: xOf(axis, alert.clearsAtS),
        text: `clears ≈ ${seconds(alert.clearsAtS)}`,
        uncertain: alert.clearsUncertain,
      });
    }
  }
  return inputs;
}

// ---- The value chart: one signal against the rule's lines ----

export interface ValueChartModel {
  kind: 'value';
  width: number;
  height: number;
  axis: ChartAxis;
  xTicks: ChartTick[];
  /** SVG paths of the line and of the soft area under it; empty when there are fewer than two points. */
  line: string;
  area: string;
  raise: { y: number; label: string } | null;
  clear: { y: number; label: string } | null;
  /** The part of the picture beyond the raise line, to draw the line a second time in amber through a clip. */
  breach: { y: number; height: number } | null;
  /** The extreme value of the line, as a tag above it. */
  tag: { x: number; y: number; label: string } | null;
  flags: ChartFlag[];
}

function valueChart(
  item: ScenarioItem,
  rule: RuleInfo | null,
  width: number,
): ValueChartModel | null {
  const { expected } = item;
  const first = item.anomalies[0];
  if (!expected.available || !first) return null;
  const lane = expected.series.find(
    (s) => s.deviceId === first.deviceId && s.metric === first.metric,
  );
  if (!lane || lane.points.length === 0) return null;

  const height = VALUE_HEIGHT;
  const axis = timeAxis(expected.horizonS, 0.25, {
    left: SIDE_MARGIN,
    right: width - SIDE_MARGIN,
    top: VALUE_TOP,
    bottom: height - VALUE_BOTTOM_MARGIN,
  });

  const lines = rule ? [rule.raise, rule.clear] : [];
  const [lo, hi] = chartDomain(lane.points, lines, rangeOf(first.metric));
  const y = (v: number) => round1(linearScale(lo, hi, axis.bottom, axis.top + TAG_ROOM)(v));

  const coords = lane.points.map((v, i) => [xOf(axis, i * lane.stepS), y(v)] as const);
  const line =
    coords.length < 2
      ? ''
      : coords.map(([x, py], i) => `${i === 0 ? 'M' : 'L'}${x},${py}`).join(' ');
  const last = coords.at(-1);
  const start = coords[0];
  const area =
    line === '' || !last || !start
      ? ''
      : `${line} L${last[0]},${axis.bottom} L${start[0]},${axis.bottom} Z`;

  // The tag sits above the point that is furthest from where the line starts: the plateau, the end of a ramp.
  const origin = lane.points[0] ?? 0;
  let extreme = 0;
  lane.points.forEach((v, i) => {
    if (Math.abs(v - origin) > Math.abs((lane.points[extreme] ?? origin) - origin)) extreme = i;
  });
  const extremeValue = lane.points[extreme] ?? origin;
  let tag: ValueChartModel['tag'] = null;
  if (Math.abs(extremeValue - origin) > 1e-9) {
    const same = lane.points.flatMap((v, i) => (v === extremeValue ? [i] : []));
    const middle = ((same[0] ?? extreme) + (same.at(-1) ?? extreme)) / 2;
    const label = `${extremeValue} ${metricUnit(first.metric)}`.trim();
    const half = (label.length * CHAR_PX) / 2;
    tag = {
      x: round1(
        Math.min(Math.max(xOf(axis, middle * lane.stepS), axis.left + half), axis.right - half),
      ),
      y: round1(y(extremeValue) - 6),
      label,
    };
  }

  const above = rule?.direction !== 'below';
  const raiseY = rule ? y(rule.raise) : null;
  return {
    kind: 'value',
    width,
    height,
    axis,
    xTicks: ticksOf(axis),
    line,
    area,
    raise: rule && raiseY !== null ? { y: raiseY, label: `raise ${rule.raise}` } : null,
    clear: rule ? { y: y(rule.clear), label: `clear ${rule.clear}` } : null,
    breach:
      raiseY === null
        ? null
        : above
          ? { y: axis.top, height: Math.max(0, raiseY - axis.top) }
          : { y: raiseY, height: Math.max(0, axis.bottom - raiseY) },
    tag,
    flags: placeFlags(flagInputs(expected.alerts, axis), axis),
  };
}

// ---- The lane chart: one lane for each signal ----

export interface ChartBlock {
  x: number;
  width: number;
  /** The value inside the block ("190 kW"); `null` when the block is too narrow for it. */
  label: string | null;
  shape: 'step' | 'ramp' | 'spike';
  title: string;
}

export interface LaneAlert {
  severity: Severity;
  /** Where the alert opens, and where it clears; `null` when no clear is known (the line runs on to the edge, dashed). */
  openX: number;
  clearX: number | null;
  uncertain: boolean;
  title: string;
}

export interface ChartLane {
  key: string;
  /** The device's short code ("DC·1"): what is written beside the lane. */
  code: string;
  /** The code with the metric when the device has more than one lane ("DC·1 Temp"): its tooltip. */
  label: string;
  shape: DeviceShape;
  /** Words for a tooltip: the device and the metric. */
  title: string;
  y: number;
  blocks: ChartBlock[];
  alerts: LaneAlert[];
}

export interface LaneChartModel {
  kind: 'lanes';
  width: number;
  height: number;
  axis: ChartAxis;
  xTicks: ChartTick[];
  lanes: ChartLane[];
  /** What the card does not draw: "+ 2 more devices, 3 anomalies"; `null` when it draws everything. */
  more: { text: string; y: number } | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function laneChart(
  item: ScenarioItem,
  devices: readonly DeviceInfo[],
  width: number,
): LaneChartModel | null {
  const { expected } = item;
  if (!expected.available) return null;

  // One lane for each device and metric, ordered by the time its first anomaly starts (a tie keeps the scenario's order).
  const groups = new Map<string, ScenarioItem['anomalies']>();
  for (const anomaly of item.anomalies) {
    const key = `${anomaly.deviceId}\u0000${anomaly.metric}`;
    groups.set(key, [...(groups.get(key) ?? []), anomaly]);
  }
  const ordered = [...groups.entries()]
    .map(([key, anomalies], index) => ({ key, anomalies, index }))
    .sort(
      (a, b) =>
        Math.min(...a.anomalies.map((x) => x.startAt)) -
          Math.min(...b.anomalies.map((x) => x.startAt)) || a.index - b.index,
    );
  const shown = ordered.slice(0, LANE_LIMIT);
  const hidden = ordered.slice(LANE_LIMIT);

  const lanesBottom = LANES_TOP + shown.length * (LANE_HEIGHT + LANE_GAP);
  const moreY = lanesBottom + 2;
  const bottom = lanesBottom + (hidden.length > 0 ? MORE_HEIGHT : 0);
  const height = bottom + AXIS_MARGIN;
  const axis = timeAxis(expected.horizonS, 0, {
    left: LANES_LEFT,
    right: width - SIDE_MARGIN,
    top: LANES_TOP,
    bottom,
  });

  const lanes = shown.map(({ key, anomalies }, row): ChartLane => {
    const first = anomalies[0]!;
    const device = devices.find((d) => d.id === first.deviceId);
    const sameDevice = ordered.filter((o) => o.anomalies[0]!.deviceId === first.deviceId).length;
    const code = device ? deviceCode(device, [...devices]) : first.deviceId;
    return {
      key,
      code,
      label: sameDevice > 1 ? `${code} ${metricLabel(first.metric)}` : code,
      shape: kindIdentity(device?.kind ?? '').shape,
      title: `${first.deviceId} ${first.metric}`,
      y: LANES_TOP + row * (LANE_HEIGHT + LANE_GAP),
      blocks: anomalies.map((a): ChartBlock => {
        const x = xOf(axis, a.startAt);
        const w = Math.max(2, round1(xOf(axis, a.startAt + a.duration) - x));
        const label = `${a.value} ${metricUnit(a.metric)}`.trim();
        return {
          x,
          width: w,
          label: w >= label.length * CHAR_PX + 12 ? label : null,
          shape: a.shape ?? 'step',
          title: `${a.deviceId} ${a.metric} ${a.value} from ${seconds(a.startAt)} for ${seconds(a.duration)}`,
        };
      }),
      alerts: expected.alerts
        .filter((alert) => alert.deviceId === first.deviceId && alert.metric === first.metric)
        .map((alert): LaneAlert => ({
          severity: alert.severity,
          openX: xOf(axis, alert.opensAtS),
          clearX: alert.clearsAtS === null ? null : xOf(axis, alert.clearsAtS),
          uncertain: alert.clearsUncertain,
          title: alert.title,
        })),
    };
  });

  let more: LaneChartModel['more'] = null;
  if (hidden.length > 0) {
    const shownDevices = new Set(shown.map((s) => s.anomalies[0]!.deviceId));
    const hiddenDevices = new Set(
      hidden.map((h) => h.anomalies[0]!.deviceId).filter((id) => !shownDevices.has(id)),
    );
    const anomalies = hidden.reduce((sum, h) => sum + h.anomalies.length, 0);
    more = {
      y: moreY,
      text:
        hiddenDevices.size > 0
          ? `+ ${plural(hiddenDevices.size, 'more device', 'more devices')}, ${plural(anomalies, 'anomaly', 'anomalies')}`
          : `+ ${plural(anomalies, 'more anomaly', 'more anomalies')}`,
    };
  }

  return { kind: 'lanes', width, height, axis, xTicks: ticksOf(axis), lanes, more };
}

export type ScenarioChartModel = ValueChartModel | LaneChartModel;

export interface ScenarioChartInput {
  item: ScenarioItem;
  rules: RulesView;
  devices: readonly DeviceInfo[];
  /** The picture's width in pixels. */
  width: number;
}

/**
 * What the card's chart draws, or `null` when there is nothing honest to draw: the rules could not be read (the card
 * says so instead), or the simulator sent no series for a one-signal scenario.
 */
export function buildScenarioChart(input: ScenarioChartInput): ScenarioChartModel | null {
  const width = Math.max(MIN_WIDTH, Math.round(input.width));
  return chartKind(input.item) === 'value'
    ? valueChart(input.item, ruleOf(input.item, input.rules, input.devices), width)
    : laneChart(input.item, input.devices, width);
}

/** The playhead of a running scenario: where it is, how much of the picture has been played, and its time. */
export function playheadOf(
  axis: ChartAxis,
  elapsedS: number,
): { x: number; playedWidth: number; label: string } {
  const clamped = Math.min(Math.max(elapsedS, 0), axis.maxS);
  const x = xOf(axis, clamped);
  return { x, playedWidth: round1(x - axis.left), label: `${Math.floor(clamped)} s` };
}

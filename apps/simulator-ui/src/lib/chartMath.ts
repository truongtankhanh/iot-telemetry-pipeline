import type { MetricProfile, RuleInfo } from '../api/types';
import type { Sample } from '../state/history';
import type { DeviceStatusKind } from './deviceStatus';
import { formatAmount, formatValue, headroom, rangeOf } from './rules';
import { metricUnit } from './deviceIdentity';
import { formatClockTime } from './time';

/**
 * The geometry of the Fleet charts, kept out of the components: where a value, a time, a line and a gap fall on
 * the picture, and the sentence that says the same to a screen reader. Pure functions of their input; the
 * components only draw what these return.
 */

export const WINDOW_MS = 120_000;

/** Maps `[d0, d1]` onto `[r0, r1]`. A flat domain maps to the middle of the range. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  if (d1 === d0) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** Round numbers inside `[lo, hi]`, about `target` of them (1, 2, 5 times a power of ten apart). */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return Number.isFinite(lo) ? [lo] : [];
  const rough = span / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(rough));
  const f = rough / power;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * power;
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const first = Math.ceil(lo / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = first; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toFixed(decimals)));
  return ticks;
}

/**
 * The vertical range of a chart: the readings and the rule's lines, with a margin, and never wider than the range
 * the contract accepts for the metric. A flat series still gets a visible span.
 */
export function chartDomain(
  values: readonly number[],
  lines: readonly number[],
  limits: { min: number; max: number } | null,
): [number, number] {
  const all = [...values, ...lines].filter(Number.isFinite);
  if (all.length === 0) return limits ? [limits.min, limits.max] : [0, 1];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) {
    const pad = Math.max(1, Math.abs(lo) * 0.05);
    lo -= pad;
    hi += pad;
  }
  const margin = (hi - lo) * 0.12;
  lo -= margin;
  hi += margin;
  if (limits) {
    lo = Math.max(lo, limits.min);
    hi = Math.min(hi, limits.max);
  }
  return [lo, hi];
}

export interface SeriesStats {
  min: number;
  avg: number;
  max: number;
  last: number;
}

/** Min, average, max and last value of a series; `null` when it is empty. */
export function summarize(samples: readonly Sample[]): SeriesStats | null {
  const last = samples[samples.length - 1];
  if (!last) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const { v } of samples) {
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
  }
  return { min, avg: sum / samples.length, max, last: last.v };
}

/** How long a device may be quiet before a stretch counts as a gap in a chart: three intervals, at least five seconds. */
export const gapThresholdMs = (intervalMs: number): number => Math.max(3 * intervalMs, 5000);

export interface Gap {
  /** Times, ms since the epoch. */
  from: number;
  to: number;
  /** Where the gap is: between two readings, or after the last one up to now. */
  kind: 'between' | 'trailing';
}

/** The stretches of the window with no readings: between two readings more than the threshold apart, and from the last to now. */
export function findGaps(samples: readonly Sample[], now: number, thresholdMs: number): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1] as Sample;
    const after = samples[i] as Sample;
    if (after.t - before.t > thresholdMs)
      gaps.push({ from: before.t, to: after.t, kind: 'between' });
  }
  const last = samples[samples.length - 1];
  if (last && now - last.t > thresholdMs) gaps.push({ from: last.t, to: now, kind: 'trailing' });
  return gaps;
}

/** Why the line stops, for the hatched gap after the last reading. */
export function trailingReason(
  status: { kind: DeviceStatusKind; since: number | null },
  lastReadingAt: number | null,
  now: number,
): string {
  const at = (t: number | null) => (t === null ? '' : ` at ${formatClockTime(t)}`);
  switch (status.kind) {
    case 'paused':
      return `Paused${at(status.since ?? lastReadingAt)}`;
    case 'stopped':
      return `Stopped${at(status.since ?? lastReadingAt)}`;
    case 'silent':
      return status.since === null ? 'Silent' : `Silent since ${formatClockTime(status.since)}`;
    default:
      return lastReadingAt === null
        ? 'No readings yet'
        : `No readings for ${Math.round((now - lastReadingAt) / 1000)} s`;
  }
}

export interface LineChartInput {
  deviceId: string;
  metric: string;
  samples: readonly Sample[];
  now: number;
  /** The rule whose raise and clear lines are drawn; `null` when there is none (or rules are not available). */
  rule: RuleInfo | null;
  status: { kind: DeviceStatusKind; since: number | null };
  /** The device's publish interval, which sets how long a quiet stretch has to be to count as a gap. */
  intervalMs: number;
  width?: number;
  height?: number;
  windowMs?: number;
}

export interface LineChartModel {
  width: number;
  height: number;
  /** The plot area inside the axes, in picture coordinates. */
  plot: { left: number; top: number; right: number; bottom: number };
  yTicks: { value: number; y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  /** An SVG path for the line, and for the soft area under it; empty when there is nothing to draw. */
  line: string;
  area: string;
  /** The part of the picture beyond the raise line, to draw the line a second time in amber through a clip. */
  breach: { y: number; height: number } | null;
  raise: { y: number; label: string; headroom: string | null; beyond: boolean } | null;
  clear: { y: number; label: string } | null;
  gaps: { x: number; width: number; reason: string }[];
  last: { x: number; y: number; label: string } | null;
  stats: { min: string; avg: string; max: string } | null;
  /** Set while the history holds less than the window: "collecting, 40 s of 2 min". */
  collecting: string | null;
  /** What the chart says, in a sentence, for `role="img"`. */
  description: string;
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

const duration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s >= 60 && s % 60 === 0 ? `${s / 60} min` : `${s} s`;
};

/** Everything a line chart draws, from the readings, the rule and the state of the device. */
export function buildLineChart(input: LineChartInput): LineChartModel {
  const { deviceId, metric, samples, now, rule, status, intervalMs } = input;
  const width = input.width ?? 480;
  const height = input.height ?? 160;
  const windowMs = input.windowMs ?? WINDOW_MS;
  const plot = { left: 44, top: 10, right: width - 56, bottom: height - 24 };
  const start = now - windowMs;

  const visible = samples.filter((s) => s.t >= start);
  const x = linearScale(start, now, plot.left, plot.right);
  const clampX = (t: number) => clampTo(x(t), plot.left, plot.right);

  const limits = rangeOf(metric);
  const lines = rule ? [rule.raise, rule.clear] : [];
  const [lo, hi] = chartDomain(
    visible.map((s) => s.v),
    lines,
    limits,
  );
  const y = linearScale(lo, hi, plot.bottom, plot.top);
  const unit = metricUnit(metric);
  const withUnit = (text: string) => (unit ? `${text} ${unit}` : text);

  const yTicks = niceTicks(lo, hi, 4).map((value) => ({
    value,
    y: y(value),
    label: formatTick(value),
  }));
  const xTicks = [
    { x: plot.left, label: `−${duration(windowMs)}` },
    { x: (plot.left + plot.right) / 2, label: `−${duration(windowMs / 2)}` },
    { x: plot.right, label: 'now' },
  ];

  const points = visible.map((s) => `${clampX(s.t).toFixed(1)} ${y(s.v).toFixed(1)}`);
  const first = visible[0];
  const lastSample = visible[visible.length - 1];
  const line = points.length > 0 ? `M${points.join(' L')}` : '';
  const area =
    first && lastSample
      ? `${line} L${clampX(lastSample.t).toFixed(1)} ${plot.bottom} L${clampX(first.t).toFixed(1)} ${plot.bottom} Z`
      : '';

  const threshold = gapThresholdMs(intervalMs);
  const gaps = findGaps(visible, now, threshold).map((gap) => {
    const from = clampX(gap.from);
    return {
      x: from,
      width: Math.max(0, clampX(gap.to) - from),
      reason:
        gap.kind === 'trailing'
          ? trailingReason(status, lastSample?.t ?? null, now)
          : 'No readings',
    };
  });
  if (!lastSample) {
    gaps.push({
      x: plot.left,
      width: plot.right - plot.left,
      reason: trailingReason(status, null, now),
    });
  }

  const raiseY = rule ? y(rule.raise) : null;
  const stats = summarize(visible);
  const fmt = (v: number) => formatValue(metric, v);

  const collecting =
    first && first.t - start > threshold
      ? `collecting, ${duration(now - first.t)} of ${duration(windowMs)}`
      : null;

  const model: LineChartModel = {
    width,
    height,
    plot,
    yTicks,
    xTicks,
    line,
    area,
    breach:
      rule && raiseY !== null
        ? rule.direction === 'above'
          ? { y: plot.top, height: Math.max(0, raiseY - plot.top) }
          : { y: raiseY, height: Math.max(0, plot.bottom - raiseY) }
        : null,
    raise: rule ? raiseLabel(rule, y(rule.raise), stats?.last ?? null) : null,
    clear: rule ? { y: y(rule.clear), label: `clear ${rule.clear}` } : null,
    gaps,
    last: lastSample
      ? { x: clampX(lastSample.t), y: y(lastSample.v), label: fmt(lastSample.v) }
      : null,
    stats: stats ? { min: fmt(stats.min), avg: fmt(stats.avg), max: fmt(stats.max) } : null,
    collecting,
    description: '',
  };
  model.description = describeChart({
    deviceId,
    metric,
    visible,
    stats,
    rule,
    status,
    collecting,
    windowMs,
    withUnit,
    fmt,
    gaps,
  });
  return model;
}

function raiseLabel(rule: RuleInfo, y: number, latest: number | null) {
  const h = latest === null ? null : headroom(rule, latest);
  return { y, label: `raise ${rule.raise}`, headroom: h?.text ?? null, beyond: h?.beyond ?? false };
}

/** An axis label: whole numbers stay whole, the others have one decimal. */
function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function describeChart(args: {
  deviceId: string;
  metric: string;
  visible: readonly Sample[];
  stats: SeriesStats | null;
  rule: RuleInfo | null;
  status: { kind: DeviceStatusKind; since: number | null };
  collecting: string | null;
  windowMs: number;
  withUnit: (text: string) => string;
  fmt: (v: number) => string;
  gaps: { reason: string }[];
}): string {
  const {
    deviceId,
    metric,
    visible,
    stats,
    rule,
    status,
    collecting,
    windowMs,
    withUnit,
    fmt,
    gaps,
  } = args;
  const head = `${metric} of ${deviceId}, last ${duration(windowMs)}`;
  const first = visible[0];
  if (!stats || !first) {
    return `${head}: no readings${gaps[0] ? ` (${gaps[0].reason})` : ''}`;
  }
  const parts = [
    `from ${withUnit(fmt(first.v))} to ${withUnit(fmt(stats.last))}`,
    `min ${fmt(stats.min)}, average ${fmt(stats.avg)}, max ${fmt(stats.max)}`,
  ];
  if (rule) {
    const h = headroom(rule, stats.last);
    parts.push(
      h.beyond
        ? `now ${h.text} line (${rule.raise}); an alert opens after ${rule.for} readings in a row`
        : `${h.text} (${rule.raise})`,
    );
  }
  if (status.kind === 'paused' || status.kind === 'stopped' || status.kind === 'silent') {
    parts.push(gaps.at(-1)?.reason ?? status.kind);
  }
  if (collecting) parts.push(collecting);
  return `${head}: ${parts.join('; ')}`;
}

/** A sparkline: the readings of the window as one path in a small box, scaled to their own min and max. */
export function sparkline(
  samples: readonly Sample[],
  now: number,
  options: { width?: number; height?: number; windowMs?: number } = {},
): { d: string; last: { x: number; y: number } | null } {
  const { width = 72, height = 22, windowMs = WINDOW_MS } = options;
  const start = now - windowMs;
  const visible = samples.filter((s) => s.t >= start);
  if (visible.length === 0) return { d: '', last: null };
  const values = visible.map((s) => s.v);
  const [lo, hi] = [Math.min(...values), Math.max(...values)];
  const pad = 2;
  const x = linearScale(start, now, pad, width - pad);
  const y = linearScale(lo, hi, height - pad, pad);
  const coords = visible.map((s) => ({ x: clampTo(x(s.t), pad, width - pad), y: y(s.v) }));
  const d = `M${coords.map((c) => `${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' L')}`;
  return { d, last: coords[coords.length - 1] ?? null };
}

export interface RangeBarModel {
  /** The span of values the bar covers, in the metric's unit. */
  lo: number;
  hi: number;
  /** The zones, left to right, as fractions of the bar (0 to 1). */
  zones: { kind: 'safe' | 'hysteresis' | 'alarm'; from: number; to: number }[];
  /** Where the clear and raise lines fall, as fractions of the bar. */
  clearAt: number;
  raiseAt: number;
  /** Fractions of the bar; `value` is clamped into it, and `offScale` says the real value is outside the span. */
  baseline: number | null;
  value: number | null;
  offScale: boolean;
  /** The same in words, for a screen reader. */
  text: string;
}

/**
 * The scale of a metric split into the safe zone, the hysteresis band between the clear and raise lines and the
 * alarm zone, with the baseline and the current value. The bar covers the interesting span (the lines, the baseline and the
 * value with a margin), not the whole contract range, where the lines would be a few pixels apart.
 */
export function rangeBarModel(input: {
  metric: string;
  rule: RuleInfo;
  profile: MetricProfile | null;
  value: number | null;
}): RangeBarModel {
  const { metric, rule, profile, value } = input;
  const points = [
    rule.raise,
    rule.clear,
    ...(profile ? [profile.baseline] : []),
    ...(value === null ? [] : [value]),
  ];
  const [lo, hi] = chartDomain([], points, rangeOf(metric));
  const f = linearScale(lo, hi, 0, 1);
  const safeToHysteresis = f(rule.clear);
  const hysteresisToAlarm = f(rule.raise);

  const zones: RangeBarModel['zones'] =
    rule.direction === 'above'
      ? [
          { kind: 'safe', from: 0, to: safeToHysteresis },
          { kind: 'hysteresis', from: safeToHysteresis, to: hysteresisToAlarm },
          { kind: 'alarm', from: hysteresisToAlarm, to: 1 },
        ]
      : [
          { kind: 'alarm', from: 0, to: hysteresisToAlarm },
          { kind: 'hysteresis', from: hysteresisToAlarm, to: safeToHysteresis },
          { kind: 'safe', from: safeToHysteresis, to: 1 },
        ];

  const unit = metricUnit(metric);
  const w = (v: number) => (unit ? `${formatAmount(v)} ${unit}` : formatAmount(v));
  const side = rule.direction === 'above' ? 'above' : 'below';
  const safeSide = rule.direction === 'above' ? 'up to' : 'from';
  const text = [
    `Safe ${safeSide} ${w(rule.clear)}`,
    `hysteresis band ${w(Math.min(rule.clear, rule.raise))} to ${w(Math.max(rule.clear, rule.raise))}`,
    `alarm ${side} ${w(rule.raise)}`,
    profile ? `baseline ${w(profile.baseline)}` : null,
    value === null ? 'no current value' : `now ${w(value)}`,
  ]
    .filter((part): part is string => part !== null)
    .join('; ');

  return {
    lo,
    hi,
    zones,
    clearAt: safeToHysteresis,
    raiseAt: hysteresisToAlarm,
    baseline: profile ? clampTo(f(profile.baseline), 0, 1) : null,
    value: value === null ? null : clampTo(f(value), 0, 1),
    offScale: value !== null && (value < lo || value > hi),
    text,
  };
}

import type { MetricName } from '@itp/telemetry-contract';
import type { RuleInfo, RuleSeverity, RulesView } from './rules-source.ts';
import { lengthS, type ScenarioDocument } from './scenario-document.ts';
import {
  ANOMALY_JITTER,
  type Anomaly,
  anomalyTarget,
  baselineValue,
  type DeviceSpec,
  metricProfile,
} from './signals.ts';

/** A reading is rounded to 0.1 before it is published, so a value this close to a line may land on either side. */
const ROUNDING = 0.05;
/** How many ticks past the end of an anomaly the walk looks for the clear before it says there is none. */
const CLEAR_SEARCH_TICKS = 10;
/** The most ticks one walk may visit: a few hours at the default interval, a refusal for a tiny interval. */
export const MAX_WALK_TICKS = 20_000;
/** The curve of a lane has at most this many steps (one more point than steps). */
const SERIES_STEPS = 120;

/** An alert the rules should raise while the scenario plays. Times are seconds from the scenario start. */
export interface ExpectedAlert {
  ruleId: string;
  title: string;
  severity: RuleSeverity;
  deviceId: string;
  metric: MetricName;
  opensAtS: number;
  /** A reading that counts toward the opening is within the jitter of the raise line: it may open later or never. */
  opensMargin: boolean;
  /** `null` when no reading comes back past the clear line within the search. */
  clearsAtS: number | null;
  /** The reading at the clear is within the noise of the clear line (or there is none): it may take longer. */
  clearsUncertain: boolean;
}

/** An anomaly that raises nothing, and why. */
export interface QuietAnomaly {
  deviceId: string;
  metric: MetricName;
  why: 'no-rule' | 'never-crosses';
}

/** The noise-free value of one device and metric at `0, stepS, 2·stepS…` up to the horizon, rounded to 0.1. */
export interface ExpectedSeries {
  deviceId: string;
  metric: MetricName;
  stepS: number;
  points: number[];
}

export type Expected =
  | { available: false; reason: string }
  | {
      available: true;
      /** The publish interval of the engine, which the tolerance of the numbers is measured in. */
      intervalS: number;
      /** The end of the picture: the end of the last anomaly, or the last clear if that comes later. */
      horizonS: number;
      alerts: ExpectedAlert[];
      quiet: QuietAnomaly[];
      series: ExpectedSeries[];
    };

export interface ExpectationOptions {
  devices: readonly DeviceSpec[];
  rules: RulesView;
  /** The engine's publish interval. */
  intervalMs: number;
  /** The interval in force for one device (its own, else the engine's). */
  intervalMsOf(deviceId: string): number;
  /** Devices the run would start: they publish first one interval after the click, so their ticks begin at 1. */
  needsStart: ReadonlySet<string>;
  /** Wall time (the engine's clock) at second 0 of the scenario; the baseline of a metric depends on it. */
  baseMs: number;
  /**
   * A limit on the ticks walked in all, summed over the lanes (the per-lane limit `MAX_WALK_TICKS` always applies).
   * Absent for a scenario of the library, which has at most `MAX_ANOMALIES` anomalies; the Lab's preview sets it,
   * because its request can hold more and the walk is synchronous on the thread that publishes.
   */
  maxTotalTicks?: number;
}

interface Lane {
  device: DeviceSpec;
  metric: MetricName;
  intervalS: number;
  anomalies: Anomaly[];
}

const inWindow = (anomaly: Anomaly, t: number) =>
  t >= anomaly.startAt && t < anomaly.startAt + anomaly.duration;

const round = (n: number) => Math.round(n * 10) / 10;

/** The noise-free value of a lane at second `t` of the scenario: the anomaly playing then, else the baseline. */
function laneValue(lane: Lane, baseMs: number, t: number): number {
  const at = new Date(baseMs + t * 1000);
  const active = lane.anomalies.find((anomaly) => inWindow(anomaly, t));
  return active
    ? anomalyTarget(active, lane.device, lane.metric, at, t)
    : baselineValue(lane.device, lane.metric, at);
}

/**
 * Walks the publish ticks of one anomaly against one rule, as ingest's `evaluate` does: a strict breach counts
 * toward `for` consecutive readings, the alert opens on the last of them, and it clears on the first later
 * reading strictly back past the clear line (one reading, no count).
 */
function walkRule(
  lane: Lane,
  anomaly: Anomaly,
  rule: RuleInfo,
  options: { baseMs: number; firstTick: number },
): ExpectedAlert | undefined {
  const { intervalS } = lane;
  const above = rule.direction === 'above';
  const breaches = (value: number) => (above ? value > rule.raise : value < rule.raise);
  const backPastClear = (value: number) => (above ? value < rule.clear : value > rule.clear);
  const end = anomaly.startAt + anomaly.duration;
  const last = end + CLEAR_SEARCH_TICKS * intervalS;

  let streak = 0;
  let margin = false;
  let opened: { t: number; margin: boolean } | undefined;
  // From this anomaly's own start: the breaches of an earlier anomaly on the lane are that one's alert.
  const firstTick = Math.max(options.firstTick, Math.ceil(anomaly.startAt / intervalS));
  for (let k = firstTick; k * intervalS <= last; k++) {
    const t = k * intervalS;
    const value = laneValue(lane, options.baseMs, t);

    if (opened === undefined) {
      if (!breaches(value)) {
        streak = 0;
        margin = false;
        continue;
      }
      streak++;
      margin ||= inWindow(anomaly, t) && Math.abs(value - rule.raise) <= ANOMALY_JITTER + ROUNDING;
      if (streak >= rule.for) opened = { t, margin };
      continue;
    }

    if (backPastClear(value)) {
      const reach = inWindow(anomaly, t)
        ? ANOMALY_JITTER + ROUNDING
        : metricProfile(lane.device, lane.metric).noise;
      return alertOf(lane, rule, opened, { t, uncertain: Math.abs(value - rule.clear) <= reach });
    }
  }
  if (opened === undefined) return undefined;
  return alertOf(lane, rule, opened, undefined);
}

function alertOf(
  lane: Lane,
  rule: RuleInfo,
  opened: { t: number; margin: boolean },
  clear: { t: number; uncertain: boolean } | undefined,
): ExpectedAlert {
  return {
    ruleId: rule.id,
    title: rule.title,
    severity: rule.severity,
    deviceId: lane.device.id,
    metric: lane.metric,
    opensAtS: opened.t,
    opensMargin: opened.margin,
    clearsAtS: clear?.t ?? null,
    clearsUncertain: clear?.uncertain ?? true,
  };
}

/**
 * The alerts a scenario should raise and when, from the rules and the publish interval, walking the tick grid
 * with the noise-free signal and the same formulas the engine publishes with (`signals.ts`). A best case that
 * assumes the ticks of a device start with the scenario; the real alert can be up to one publish interval later,
 * and a clear can take longer when the baseline is within the noise of the clear line (`clearsUncertain`).
 *
 * Pure: no clock, no engine. `{ available: false }` when the rules file could not be read, or when the interval
 * is so short that the walk would exceed `MAX_WALK_TICKS`.
 */
export function expectedAlerts(scenario: ScenarioDocument, options: ExpectationOptions): Expected {
  const { rules } = options;
  if (!rules.available) {
    return { available: false, reason: rules.reason ?? 'The rules are not available' };
  }

  const lanes = new Map<string, Lane>();
  for (const anomaly of scenario.anomalies) {
    const key = `${anomaly.deviceId}\u0000${anomaly.metric}`;
    let lane = lanes.get(key);
    if (!lane) {
      const device = options.devices.find((d) => d.id === anomaly.deviceId);
      // The library checks a scenario against this registry before it keeps it: reaching here is a bug.
      if (!device)
        throw new Error(`Scenario "${scenario.name}" names unknown device "${anomaly.deviceId}"`);
      lane = {
        device,
        metric: anomaly.metric,
        intervalS: options.intervalMsOf(device.id) / 1000,
        anomalies: [],
      };
      lanes.set(key, lane);
    }
    lane.anomalies.push(anomaly);
  }

  const laneTicks = [...lanes.values()].map(
    (lane) => lengthS(scenario) / lane.intervalS + CLEAR_SEARCH_TICKS,
  );
  if (Math.max(...laneTicks) > MAX_WALK_TICKS) {
    return {
      available: false,
      reason: `A publish interval of ${options.intervalMs} ms is too short to work out the alerts of a ${lengthS(scenario)} s scenario`,
    };
  }
  const totalTicks = Math.ceil(laneTicks.reduce((sum, ticks) => sum + ticks, 0));
  if (options.maxTotalTicks !== undefined && totalTicks > options.maxTotalTicks) {
    return {
      available: false,
      reason: `Too many readings to work out the alerts of ${scenario.anomalies.length} anomalies on ${lanes.size} signals over ${lengthS(scenario)} s: ${totalTicks} against a limit of ${options.maxTotalTicks}`,
    };
  }

  const alerts: ExpectedAlert[] = [];
  const quiet: QuietAnomaly[] = [];
  for (const lane of lanes.values()) {
    const firstTick = options.needsStart.has(lane.device.id) ? 1 : 0;
    for (const anomaly of lane.anomalies) {
      const matching = rules.items.filter(
        (rule) => rule.kind === lane.device.kind && rule.metric === lane.metric,
      );
      const found = matching
        .map((rule) => walkRule(lane, anomaly, rule, { baseMs: options.baseMs, firstTick }))
        .filter((alert) => alert !== undefined);
      alerts.push(...found);
      if (found.length === 0) {
        const why = matching.length === 0 ? 'no-rule' : 'never-crosses';
        quiet.push({ deviceId: lane.device.id, metric: lane.metric, why });
      }
    }
  }
  alerts.sort(
    (a, b) =>
      a.opensAtS - b.opensAtS ||
      a.deviceId.localeCompare(b.deviceId) ||
      a.ruleId.localeCompare(b.ruleId),
  );

  const horizonS = Math.max(lengthS(scenario), ...alerts.map((alert) => alert.clearsAtS ?? 0));
  const series = [...lanes.values()].map((lane): ExpectedSeries => {
    const stepS = Math.max(lane.intervalS, horizonS / SERIES_STEPS);
    const points = Array.from({ length: Math.floor(horizonS / stepS) + 1 }, (_, i) =>
      round(laneValue(lane, options.baseMs, i * stepS)),
    );
    return { deviceId: lane.device.id, metric: lane.metric, stepS, points };
  });

  return {
    available: true,
    intervalS: options.intervalMs / 1000,
    horizonS,
    alerts,
    quiet,
    series,
  };
}

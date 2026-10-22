import type { MetricName } from '@itp/telemetry-contract';
import type {
  Anomaly,
  AnomalyRequest,
  DeviceInfo,
  EngineSnapshot,
  ExpectedAlert,
  RuleInfo,
  RulesView,
  ScenarioRunView,
  StateView,
} from '../api/types';
import { metricUnit } from './deviceIdentity';
import { holdMetrics } from './holdTargets';
import { rangeOf, rulesFor } from './rules';
import { seconds } from './scenarioExpectation';

/**
 * The fault being configured in the Lab (frames 12 and 19), as pure functions: what the form may hold, whether it can
 * be sent, and the anomalies it becomes. Nothing here works out an alert time (the simulator does, `getExpected`); the
 * sentences only say what the form itself fixes, such as when the first and the last device start.
 */

/** The longest anomaly the simulator accepts in a scenario file, and what a Manual fault is given until it is removed. */
export const MAX_DURATION_S = 3600;

export type FaultTile =
  | 'breach'
  | 'silent'
  | 'drop'
  | 'delay'
  | 'burst'
  | 'malformed'
  | 'duplicate'
  | 'reorder'
  | 'link-loss';

export interface FaultTileInfo {
  id: FaultTile;
  label: string;
  /** False for a fault the engine cannot play yet. */
  available: boolean;
  /** Why it cannot be chosen; `null` when it can. */
  reason: string | null;
}

const LATER = 'Comes with SIM-12';

/** The nine tiles of the frame. Only a breach exists in the engine: the others are SIM-12's. */
export const FAULT_TILES: readonly FaultTileInfo[] = [
  { id: 'breach', label: 'Breach', available: true, reason: null },
  { id: 'silent', label: 'Silent', available: false, reason: LATER },
  { id: 'drop', label: 'Drop', available: false, reason: LATER },
  { id: 'delay', label: 'Delay', available: false, reason: LATER },
  { id: 'burst', label: 'Burst', available: false, reason: LATER },
  { id: 'malformed', label: 'Malformed', available: false, reason: LATER },
  { id: 'duplicate', label: 'Duplicate', available: false, reason: LATER },
  { id: 'reorder', label: 'Reorder', available: false, reason: LATER },
  { id: 'link-loss', label: 'Link loss', available: false, reason: LATER },
];

export type FaultShape = 'step' | 'ramp' | 'spike';

export const FAULT_SHAPES: readonly FaultShape[] = ['step', 'ramp', 'spike'];

export type StopCondition = 'timed' | 'alert-clears' | 'manual';

export interface StopOption {
  id: StopCondition;
  label: string;
  available: boolean;
  reason: string | null;
}

export const STOP_OPTIONS: readonly StopOption[] = [
  { id: 'timed', label: 'Timed', available: true, reason: null },
  {
    id: 'alert-clears',
    label: 'Alert clears',
    available: false,
    reason:
      'An alert clears only after the fault has ended, so it cannot end it. Use Timed or Manual.',
  },
  { id: 'manual', label: 'Manual', available: true, reason: null },
];

/** What the form holds. A number is `null` while its field is empty. */
export interface FaultDraft {
  tile: FaultTile;
  /** `null`: the metric the most devices chosen report. */
  metric: string | null;
  /** `null`: worked out from the rule (`breachValue`). */
  value: number | null;
  shape: FaultShape;
  /** Seconds from now until the first device changes. */
  startAt: number | null;
  /** Seconds the fault lasts (a Manual fault lasts until it is removed). */
  duration: number | null;
  /** Seconds between one device's start and the next one's; used only with more than one device. */
  stagger: number | null;
  stop: StopCondition;
}

export const DEFAULT_FAULT: FaultDraft = {
  tile: 'breach',
  metric: null,
  value: null,
  shape: 'step',
  startAt: 20,
  duration: 60,
  stagger: 2,
  stop: 'timed',
};

/** The metric the fault is on when the form has not chosen one: the one most devices report. */
export function defaultMetric(reached: readonly DeviceInfo[]): string | null {
  return holdMetrics(reached)[0] ?? null;
}

/** A value for a metric that is rounded the way its readings are: ppm whole, the rest to a tenth. */
const roundFor = (metric: string, value: number) =>
  metric === 'co2_ppm' ? Math.round(value) : Math.round(value * 10) / 10;

/**
 * The value a breach starts from: a little beyond the rule's raise line (29.2 °C for 27), so the fault does something
 * when it is sent unchanged. Without a rule, a tenth of the metric's range above the baseline. Always inside the
 * contract's range; `null` for a metric the contract does not have.
 */
export function breachValue(
  metric: string,
  rule: RuleInfo | null,
  baseline: number | null,
): number | null {
  const range = rangeOf(metric);
  if (range === null) return null;
  let raw: number;
  if (rule !== null) {
    const delta = Math.max(2.2, Math.abs(rule.raise) * 0.08);
    raw = rule.direction === 'above' ? rule.raise + delta : rule.raise - delta;
  } else if (baseline !== null) {
    raw = baseline + (range.max - range.min) * 0.1;
  } else {
    return null;
  }
  return roundFor(metric, Math.min(range.max, Math.max(range.min, raw)));
}

export interface SliderModel {
  min: number;
  max: number;
  step: number;
  /** Where the value is on the track, 0 to 100. */
  valuePct: number;
  raisePct: number | null;
  clearPct: number | null;
}

/** The value slider: the contract's range as the track, the rule's lines as marks. */
export function sliderModel(
  metric: string,
  value: number | null,
  rule: RuleInfo | null,
): SliderModel | null {
  const range = rangeOf(metric);
  if (range === null) return null;
  const pct = (v: number) =>
    Math.min(100, Math.max(0, ((v - range.min) / (range.max - range.min)) * 100));
  return {
    min: range.min,
    max: range.max,
    step: metric === 'co2_ppm' ? 1 : 0.1,
    valuePct: pct(value ?? range.min),
    raisePct: rule === null ? null : pct(rule.raise),
    clearPct: rule === null ? null : pct(rule.clear),
  };
}

export interface FaultErrors {
  metric?: string;
  value?: string;
  startAt?: string;
  duration?: string;
  stagger?: string;
}

const finite = (n: number | null): n is number => n !== null && Number.isFinite(n);

/** What is wrong with each field, in words that name it; nothing for a field that is fine. */
export function validateFault(
  draft: FaultDraft,
  input: { metric: string | null; value: number | null },
): FaultErrors {
  const errors: FaultErrors = {};
  const { metric, value } = input;
  if (metric === null) errors.metric = 'Choose a metric that the devices report';
  const range = metric === null ? null : rangeOf(metric);
  if (!finite(value)) errors.value = 'Enter a value';
  else if (range !== null && (value < range.min || value > range.max)) {
    const unit = metricUnit(metric as string);
    errors.value = `Enter a value from ${range.min} to ${range.max}${unit === '' ? '' : ` ${unit}`}`;
  }
  if (!finite(draft.startAt) || draft.startAt < 0) errors.startAt = 'Start at must be 0 s or more';
  if (draft.stop !== 'manual') {
    if (!finite(draft.duration) || draft.duration <= 0 || draft.duration > MAX_DURATION_S) {
      errors.duration = `Duration must be above 0 s and at most ${MAX_DURATION_S} s`;
    }
  }
  if (!finite(draft.stagger) || draft.stagger < 0) errors.stagger = 'Stagger must be 0 s or more';
  return errors;
}

export const hasErrors = (errors: FaultErrors): boolean => Object.keys(errors).length > 0;

/**
 * The anomalies the form makes for these devices, times in seconds from now: one per device, each starting
 * `stagger` seconds after the one before. A Manual fault is given the longest duration until it is removed. Empty
 * when there is nothing valid to send.
 */
export function buildAnomalies(
  draft: FaultDraft,
  input: { metric: string; value: number; deviceIds: readonly string[] },
): Anomaly[] {
  const { startAt, duration, stagger } = draft;
  if (!finite(startAt) || startAt < 0) return [];
  const length = draft.stop === 'manual' ? MAX_DURATION_S : duration;
  if (!finite(length) || length <= 0) return [];
  const step = input.deviceIds.length > 1 && finite(stagger) && stagger > 0 ? stagger : 0;
  return input.deviceIds.map((deviceId, index) => ({
    deviceId,
    metric: input.metric as Anomaly['metric'],
    value: input.value,
    startAt: Math.round((startAt + index * step) * 1000) / 1000,
    duration: length,
    ...(draft.shape === 'step' ? {} : { shape: draft.shape }),
  }));
}

/**
 * The line under the stagger field: when the first and the last device start, and, when the simulator has said, when the
 * alerts are expected (its numbers, not ours). `null` for one device, where there is no stagger.
 */
export function staggerSentence(
  anomalies: readonly Anomaly[],
  alerts: readonly ExpectedAlert[] | null,
): string | null {
  if (anomalies.length < 2) return null;
  const starts = anomalies.map((anomaly) => anomaly.startAt);
  const first = Math.min(...starts);
  const last = Math.max(...starts);
  const base = `First device at ${seconds(first)}, the last of ${anomalies.length} at ${seconds(last)}.`;
  if (alerts === null || alerts.length === 0) return base;
  const opens = alerts.map((alert) => alert.opensAtS);
  return `${base} Alerts are expected from ${seconds(Math.min(...opens))} to ${seconds(Math.max(...opens))}.`;
}

/** The anomaly requests for the engine: times from now become times on the engine's anomaly clock (decision D1). */
export function toRequests(anomalies: readonly Anomaly[], elapsedS: number): AnomalyRequest[] {
  return anomalies.map((anomaly) => ({
    ...anomaly,
    startAt: Math.round((elapsedS + anomaly.startAt) * 1000) / 1000,
  }));
}

/** An anomaly already on the engine that one of these would play under (the engine plays the first match). */
export interface EngineConflict {
  id: string;
  deviceId: string;
  metric: string;
  /** Seconds from now when the existing one starts (negative: it is playing) and ends. */
  fromS: number;
  toS: number;
}

/** The anomalies on the engine that overlap any of these on the same device and metric (decision D2). */
export function engineConflicts(
  anomalies: readonly Anomaly[],
  engine: Pick<EngineSnapshot, 'anomalies' | 'elapsedS'>,
): EngineConflict[] {
  const found: EngineConflict[] = [];
  for (const { id, anomaly: existing } of engine.anomalies) {
    const fromS = existing.startAt - engine.elapsedS;
    const toS = fromS + existing.duration;
    const clash = anomalies.some(
      (mine) =>
        mine.deviceId === existing.deviceId &&
        mine.metric === existing.metric &&
        mine.startAt < toS &&
        fromS < mine.startAt + mine.duration,
    );
    if (clash) found.push({ id, deviceId: existing.deviceId, metric: existing.metric, fromS, toS });
  }
  return found;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** When a fault is on the engine, from now: "until 55 s from now", "from 20 s to 80 s from now", "ended". */
export function windowText(fromS: number, toS: number): string {
  if (toS <= 0) return 'ended';
  return fromS <= 0
    ? `until ${seconds(round1(toS))} from now`
    : `from ${seconds(round1(fromS))} to ${seconds(round1(toS))} from now`;
}

/** "dc-env-03 already has a fault on temperature_c until 80 s from now", for the first few, then "and 4 more". */
export function conflictSentence(conflicts: readonly EngineConflict[], limit = 2): string | null {
  if (conflicts.length === 0) return null;
  const parts = conflicts
    .slice(0, limit)
    .map((c) => `${c.deviceId} already has a fault on ${c.metric} ${windowText(c.fromS, c.toS)}`);
  const more = conflicts.length - parts.length;
  return `${parts.join('; ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * The faults on the engine that no scenario run owns: the ones the Lab injected, or the command line's. A run's own
 * anomalies are stopped with the run, not one by one.
 */
export function looseAnomalies(
  engine: Pick<EngineSnapshot, 'anomalies'>,
  runs: readonly ScenarioRunView[],
): EngineSnapshot['anomalies'] {
  const owned = new Set(runs.flatMap((run) => run.anomalyIds));
  return engine.anomalies.filter((entry) => !owned.has(entry.id));
}

export interface FaultPlan {
  /** The metric in force: the form's if the devices report it, else the most common one. */
  metric: string | null;
  /** The value in force: the form's, else the breach value. */
  value: number | null;
  rule: RuleInfo | null;
  /** Devices that report the metric: the ones the fault reaches. */
  deviceIds: string[];
  /** Devices chosen that do not report it: left out, and said. */
  skipped: string[];
  errors: FaultErrors;
  /** Empty while the form cannot be sent. */
  anomalies: Anomaly[];
  conflicts: EngineConflict[];
  /** Why it cannot be sent, in words; `null` when it can. */
  blocker: string | null;
}

export interface PlanInput {
  draft: FaultDraft;
  /** The devices the choice reaches (`resolveTargets`). */
  reached: readonly DeviceInfo[];
  rules: RulesView;
  profiles: StateView['profiles'];
  engine: Pick<EngineSnapshot, 'anomalies' | 'elapsedS'>;
}

/** Everything the panel needs to know about the fault being configured, from its inputs alone. */
export function planFault({ draft, reached, rules, profiles, engine }: PlanInput): FaultPlan {
  const tile = FAULT_TILES.find((t) => t.id === draft.tile);
  const offered = new Set(holdMetrics(reached));
  const metric =
    draft.metric !== null && offered.has(draft.metric) ? draft.metric : defaultMetric(reached);
  const deviceIds =
    metric === null
      ? []
      : reached.filter((d) => d.metrics.some((m) => m === metric)).map((d) => d.id);
  const skipped = reached.filter((d) => !deviceIds.includes(d.id)).map((d) => d.id);

  const first = reached.find((d) => deviceIds.includes(d.id));
  const rule =
    first === undefined || metric === null ? null : (rulesFor(rules, first, metric)[0] ?? null);
  const baseline =
    first === undefined || metric === null
      ? null
      : (profiles[first.id]?.[metric as MetricName]?.baseline ?? null);
  const value = draft.value ?? (metric === null ? null : breachValue(metric, rule, baseline));

  const errors = validateFault(draft, { metric, value });
  const anomalies =
    !hasErrors(errors) && metric !== null && value !== null && deviceIds.length > 0
      ? buildAnomalies(draft, { metric, value, deviceIds })
      : [];
  const conflicts = engineConflicts(anomalies, engine);

  let blocker: string | null = null;
  if (reached.length === 0) blocker = 'Choose at least one target';
  else if (!tile?.available) blocker = tile?.reason ?? 'This fault is not available';
  else if (metric === null || deviceIds.length === 0)
    blocker = 'None of the targets reports a metric to change';
  else if (hasErrors(errors)) blocker = Object.values(errors)[0] ?? null;
  else if (conflicts.length > 0) blocker = conflictSentence(conflicts);

  return { metric, value, rule, deviceIds, skipped, errors, anomalies, conflicts, blocker };
}

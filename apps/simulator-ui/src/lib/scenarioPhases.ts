import type { ExpectedAlert, ObservedAlert, ScenarioItem, ScenarioRunView } from '../api/types';
import { metricUnit } from './deviceIdentity';
import { seconds } from './scenarioExpectation';

/**
 * The progress bar of the Overview's controls (frame 11): a scenario as three named phases on one bar, the flags of the
 * alerts the rules should raise and clear, a playhead, and two plain lines (what has happened, what comes next). Like the
 * scenario card, it works out no alert time: the simulator did (`expected`), and the bar only says it. The only thing it
 * adds is whether an alert has _happened_, which it reads from the alerts Studio observed. Times are plain seconds from
 * the scenario start, never `t+N`.
 */

/** The most alerts whose flags are drawn on the bar; the sentence still counts all of them. */
export const FLAG_LIMIT = 4;
/** An alert that opened this much before the run's start (ingest's clock against the simulator's) is still its alert. */
const CLOCK_SLACK_MS = 2000;

export type PhaseId = 'normal' | 'anomaly' | 'recovery';

export interface PhaseSegment {
  id: PhaseId;
  label: string;
  /** What the phase is, in a few words, for the label under the bar: "0–20 s", or "29.2 °C · 20–80 s". */
  detail: string;
  fromS: number;
  toS: number;
  /** Where it starts and how wide it is, in percent of the bar. */
  leftPct: number;
  widthPct: number;
}

export interface PhaseFlag {
  /** `opens` is filled when the alert has opened, `clears` when it has cleared; hollow before. */
  kind: 'opens' | 'clears';
  title: string;
  atS: number;
  leftPct: number;
  /** It has happened (an alert that Studio observed). */
  done: boolean;
  /** The time is a best case (`opensMargin`, `clearsUncertain`). */
  uncertain: boolean;
  /** For the flag's tooltip: "Alert opened at 24 s". */
  text: string;
}

export type PhaseModel =
  | { available: false; reason: string }
  | {
      available: true;
      totalS: number;
      segments: PhaseSegment[];
      flags: PhaseFlag[];
      /** Seconds into the scenario, or `null` when it is not running. */
      elapsedS: number | null;
      /** Where the playhead and the end of the solid part are, in percent; `null` when it is not running. */
      playheadPct: number | null;
      /** "41 s". */
      playheadText: string | null;
      /** What has happened, and what comes next. */
      happened: string;
      next: string;
      /** For `role="img"`: the whole bar in a sentence. */
      description: string;
    };

export interface PhaseInput {
  item: ScenarioItem;
  /** The run of this scenario that is playing, if any. */
  run: Pick<ScenarioRunView, 'startedAt'> | undefined;
  /** Seconds into the scenario (`scenarioElapsedS`); `null` when it is not running. */
  elapsedS: number | null;
  /** The alerts Studio has seen, newest first. */
  alerts: readonly ObservedAlert[];
}

const pct = (value: number, total: number) => (total <= 0 ? 0 : (value / total) * 100);
const range = (from: number, to: number) => `${from}–${seconds(to)}`;

/** The alert of ingest that this expected alert became, or `undefined`: same device and rule, opened once the run began. */
function observedFor(
  expected: ExpectedAlert,
  alerts: readonly ObservedAlert[],
  startedAt: string,
): ObservedAlert | undefined {
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return undefined;
  return alerts.find(
    (alert) =>
      alert.deviceId === expected.deviceId &&
      alert.ruleId === expected.ruleId &&
      Date.parse(alert.openedAt) >= startedMs - CLOCK_SLACK_MS,
  );
}

function anomalyDetail(item: ScenarioItem): string {
  const only = item.anomalies.length === 1 ? item.anomalies[0] : undefined;
  if (only === undefined) {
    const devices = new Set(item.anomalies.map((anomaly) => anomaly.deviceId)).size;
    return `${devices} ${devices === 1 ? 'device' : 'devices'}`;
  }
  const unit = metricUnit(only.metric);
  return `${only.value}${unit === '' ? '' : ` ${unit}`}`;
}

function opensPhrase(alert: ExpectedAlert): string {
  return `opens about ${seconds(alert.opensAtS)}${alert.opensMargin ? ' or later' : ''}`;
}

/** "Alert clears about 80 s, in 39 s". */
function clearsPhrase(alert: ExpectedAlert, elapsedS: number | null): string {
  if (alert.clearsAtS === null) return 'clear time not known';
  const at = `clears about ${seconds(alert.clearsAtS)}${alert.clearsUncertain ? ' or later' : ''}`;
  if (elapsedS === null) return at;
  return `${at}, in ${seconds(Math.max(0, Math.round(alert.clearsAtS - elapsedS)))}`;
}

export function scenarioPhases(input: PhaseInput): PhaseModel {
  const { item, run, elapsedS, alerts } = input;
  const { expected } = item;
  if (!expected.available) return { available: false, reason: expected.reason };

  const totalS = Math.max(expected.horizonS, item.lengthS);
  const firstStart =
    item.anomalies.length === 0 ? 0 : Math.min(...item.anomalies.map((anomaly) => anomaly.startAt));
  const anomalyEnd = item.lengthS;

  const raw: Omit<PhaseSegment, 'leftPct' | 'widthPct'>[] = [
    { id: 'normal', label: 'Normal', detail: range(0, firstStart), fromS: 0, toS: firstStart },
    {
      id: 'anomaly',
      label: 'Anomaly',
      detail: `${anomalyDetail(item)} · ${range(firstStart, anomalyEnd)}`,
      fromS: firstStart,
      toS: anomalyEnd,
    },
    {
      id: 'recovery',
      label: 'Recovery',
      detail: range(anomalyEnd, totalS),
      fromS: anomalyEnd,
      toS: totalS,
    },
  ];
  // A phase of no length (an anomaly from the first second, a clear before the end) has nothing to draw.
  const segments = raw
    .filter((segment) => segment.toS > segment.fromS)
    .map((segment) => ({
      ...segment,
      leftPct: pct(segment.fromS, totalS),
      widthPct: pct(segment.toS - segment.fromS, totalS),
    }));

  const states = expected.alerts.map((alert) => ({
    alert,
    observed: run === undefined ? undefined : observedFor(alert, alerts, run.startedAt),
  }));

  const flags: PhaseFlag[] = [];
  for (const { alert, observed } of states.slice(0, FLAG_LIMIT)) {
    flags.push({
      kind: 'opens',
      title: alert.title,
      atS: alert.opensAtS,
      leftPct: pct(alert.opensAtS, totalS),
      done: observed !== undefined,
      uncertain: alert.opensMargin,
      text: `${alert.title} ${observed === undefined ? 'opens about' : 'opened; expected'} ${seconds(alert.opensAtS)}`,
    });
    if (alert.clearsAtS !== null) {
      flags.push({
        kind: 'clears',
        title: alert.title,
        atS: alert.clearsAtS,
        leftPct: pct(alert.clearsAtS, totalS),
        done: observed?.status === 'cleared',
        uncertain: alert.clearsUncertain,
        text: `${alert.title} ${observed?.status === 'cleared' ? 'cleared; expected' : 'clears about'} ${seconds(alert.clearsAtS)}`,
      });
    }
  }

  const elapsed = elapsedS === null ? null : Math.min(Math.max(elapsedS, 0), totalS);
  const openedCount = states.filter((s) => s.observed !== undefined).length;
  const clearedCount = states.filter((s) => s.observed?.status === 'cleared').length;

  const startedMs = run === undefined ? NaN : Date.parse(run.startedAt);
  const happened = ((): string => {
    if (run === undefined) return 'Not running';
    if (states.length === 0) return 'No alert is expected';
    if (states.length === 1) {
      const only = states[0]!;
      if (only.observed === undefined) {
        const late = elapsed !== null && elapsed > only.alert.opensAtS + 2 * expected.intervalS;
        return late ? 'Alert not seen yet' : 'No alert yet';
      }
      const at = Math.round((Date.parse(only.observed.openedAt) - startedMs) / 1000);
      const opened = Number.isFinite(at)
        ? `Alert opened ${seconds(Math.max(0, at))} ✓`
        : 'Alert opened ✓';
      return only.observed.status === 'cleared' ? `${opened}, cleared ✓` : opened;
    }
    return clearedCount > 0
      ? `${openedCount} of ${states.length} alerts opened, ${clearedCount} cleared`
      : `${openedCount} of ${states.length} alerts opened`;
  })();

  const next = ((): string => {
    if (states.length === 0) {
      const quiet = expected.quiet[0];
      return quiet === undefined
        ? 'The rules are not expected to raise an alert'
        : quiet.why === 'no-rule'
          ? `No rule watches ${quiet.metric} on ${quiet.deviceId}`
          : `${quiet.metric} on ${quiet.deviceId} never goes beyond a raise line`;
    }
    const waiting = states
      .filter((s) => s.observed === undefined)
      .sort((a, b) => a.alert.opensAtS - b.alert.opensAtS)[0];
    const lead = (title: string) => (states.length === 1 ? 'Alert' : title);
    if (waiting !== undefined) return `${lead(waiting.alert.title)} ${opensPhrase(waiting.alert)}`;
    const open = states
      .filter((s) => s.observed?.status === 'open')
      .sort((a, b) => (a.alert.clearsAtS ?? Infinity) - (b.alert.clearsAtS ?? Infinity))[0];
    if (open !== undefined) {
      return open.alert.clearsAtS === null
        ? `${lead(open.alert.title)}: ${clearsPhrase(open.alert, elapsed)}`
        : `${lead(open.alert.title)} ${clearsPhrase(open.alert, elapsed)}`;
    }
    return states.length === 1 ? 'Alert cleared' : 'Every alert cleared';
  })();

  const description = [
    `${item.name}: ${segments.map((s) => `${s.label.toLowerCase()} ${s.detail}`).join(', ')}`,
    `${happened}. ${next}`,
    ...(elapsed === null ? [] : [`now at ${seconds(Math.round(elapsed))}`]),
  ].join('; ');

  return {
    available: true,
    totalS,
    segments,
    flags,
    elapsedS: elapsed,
    playheadPct: elapsed === null ? null : pct(elapsed, totalS),
    playheadText: elapsed === null ? null : seconds(Math.round(elapsed)),
    happened,
    next,
    description,
  };
}

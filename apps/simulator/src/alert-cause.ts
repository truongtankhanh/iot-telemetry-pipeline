import type { IngestAlert } from './alert-observer.ts';
import type { ObservationEvent } from './observation-store.ts';

/** An anomaly that a scenario run added, as the `scenario-run` observation records it. */
export interface ScenarioRunAnomaly {
  id: string;
  deviceId: string;
  metric: string;
  /** On the engine clock, with the run's offset already added (the engine's own `startAt`). */
  startAt: number;
  duration: number;
}

/** One `POST /api/scenarios/:name/run`, with the wall time Studio saw it. */
export interface ScenarioRun {
  name: string;
  at: string;
  offsetS: number;
  anomalies: ScenarioRunAnomaly[];
}

/** Why an alert exists, when Studio can tell: a scenario it started. */
export interface AlertCause {
  scenario: string;
  /** When Studio saw the run start (wall time, ISO 8601). */
  startedAt: string;
}

/**
 * How long after an anomaly ends an alert still counts as its. The rule needs `for` breaching readings before
 * it opens, so an alert normally opens inside the anomaly; the slack covers a short anomaly and a small
 * difference between the clocks of ingest and the simulator.
 */
export const CAUSE_SLACK_S = 30;

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseAnomaly(item: unknown): ScenarioRunAnomaly | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const { id, deviceId, metric, startAt, duration } = item as Record<string, unknown>;
  if (!isString(id) || !isString(deviceId) || !isString(metric)) return undefined;
  if (!isNumber(startAt) || !isNumber(duration)) return undefined;
  return { id, deviceId, metric, startAt, duration };
}

/**
 * Reads a `scenario-run` observation. An observation made before it carried its anomalies has none to
 * match, and a malformed one is not a run: both are `undefined`, never a guess.
 */
export function parseScenarioRun(event: ObservationEvent): ScenarioRun | undefined {
  if (event.kind !== 'scenario-run') return undefined;
  const { name, offsetS, anomalies } = event.data;
  if (!isString(name) || !isNumber(offsetS) || !Array.isArray(anomalies)) return undefined;
  const parsed: ScenarioRunAnomaly[] = [];
  for (const item of anomalies) {
    const anomaly = parseAnomaly(item);
    if (anomaly) parsed.push(anomaly);
  }
  return { name, at: event.at, offsetS, anomalies: parsed };
}

/**
 * The scenario that raised an alert, or `null`. It claims a cause only on evidence: a run Studio started
 * added an anomaly on this alert's device and metric, and the alert opened while that anomaly played (or
 * within `CAUSE_SLACK_S` after it). The newest such run wins. An alert from the CLI's `--scenario`, from a
 * hand-added anomaly or from anything else matches no run and has no cause.
 *
 * `simulated` engines have a clock of their own that has no relation to the wall time of `openedAt`, so
 * they never claim one. `runs` are oldest first, as `ObservationStore.byKind` returns them.
 */
export function alertCause(
  alert: Pick<IngestAlert, 'deviceId' | 'metric' | 'openedAt'>,
  runs: readonly ScenarioRun[],
  options: { simulated: boolean },
): AlertCause | null {
  if (options.simulated) return null;
  const openedMs = Date.parse(alert.openedAt);
  if (!Number.isFinite(openedMs)) return null;

  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i] as ScenarioRun;
    const runMs = Date.parse(run.at);
    if (!Number.isFinite(runMs)) continue;
    const played = run.anomalies.some((anomaly) => {
      if (anomaly.deviceId !== alert.deviceId || anomaly.metric !== alert.metric) return false;
      const startMs = runMs + (anomaly.startAt - run.offsetS) * 1000;
      const endMs = startMs + (anomaly.duration + CAUSE_SLACK_S) * 1000;
      return openedMs >= startMs && openedMs <= endMs;
    });
    if (played) return { scenario: run.name, startedAt: run.at };
  }
  return null;
}

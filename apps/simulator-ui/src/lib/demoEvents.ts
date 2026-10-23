import type { ObservationEvent, ObservedAlert, RuleInfo } from '../api/types';
import type { Sample } from '../state/history';
import type { DemoAwait, DemoStep } from './demoScript';
import { isBeyond } from './rules';

/** What the matchers read: the observation log (newest first), the readings of the awaited metric, the rule and the alerts. */
export interface MatchInputs {
  /** The observation log's events, newest first (`ObservationLogSnapshot.events`). */
  events: readonly ObservationEvent[];
  /** The id of the newest event, `0` when there is none. */
  newestId: number;
  /** The readings of the metric of the awaited rule on the awaited device, oldest first. */
  series: readonly Sample[];
  /** The rule the step is about; `null` when the simulator has no rules. */
  rule: RuleInfo | null;
  /** The alerts of the state view. */
  alerts: readonly Pick<ObservedAlert, 'id' | 'status' | 'ruleId' | 'deviceId'>[];
}

/**
 * What was true when the awaited events began to count. Only what happens after it is a match: an alert that was already open,
 * an incident of an earlier run and the previous pass of the script are not.
 */
export interface Baseline {
  /** The id of the newest observation then, `0` when there was none. */
  observationId: number;
  /** The `t` of the newest reading of the series then, `null` when it had none. Compared by `t`, so a clock difference between the browser and the simulator cannot matter. */
  seriesT: number | null;
  /** The alerts of the awaited rule on the awaited device that were open then. */
  openAlertIds: string[];
  /** When it was taken (ms), for the elapsed time of the step. */
  at: number;
}

const openAlertsOf = (inputs: MatchInputs, awaited: DemoAwait | undefined): string[] =>
  awaited === undefined
    ? []
    : inputs.alerts
        .filter(
          (alert) =>
            alert.status === 'open' &&
            alert.ruleId === awaited.ruleId &&
            alert.deviceId === awaited.deviceId,
        )
        .map((alert) => alert.id);

/** A fresh baseline: the state of the observation log, the series and the alerts at `now`. */
export function takeBaseline(
  inputs: MatchInputs,
  awaited: DemoAwait | undefined,
  now: number,
): Baseline {
  return {
    observationId: inputs.newestId,
    seriesT: inputs.series.at(-1)?.t ?? null,
    openAlertIds: openAlertsOf(inputs, awaited),
    at: now,
  };
}

/**
 * The baseline of a step. A step that does something (starts a scenario) takes a fresh one: what it causes happens after it.
 * A step that only waits keeps the one of the step before it, so an event that happened while the presenter was still reading the
 * previous step (the incident arrives while the alert's narration is on screen) still counts: the audience has seen it happen
 * and the step says so instead of waiting for something that will not come again.
 */
export function beginStep(
  step: DemoStep,
  previous: Baseline | null,
  inputs: MatchInputs,
  now: number,
): Baseline {
  if (step.action !== undefined || previous === null) return takeBaseline(inputs, step.await, now);
  return previous;
}

/**
 * A simulator that started again numbers its observations from 1: a log whose newest id is below the baseline is a new log, and
 * everything in it is after the baseline.
 */
export function rebase(baseline: Baseline, inputs: MatchInputs): Baseline {
  return inputs.newestId < baseline.observationId ? { ...baseline, observationId: 0 } : baseline;
}

/** What the page shows while a step waits. */
export interface MatchProgress {
  /** For `rule-raised`: readings in a row beyond the raise line since the baseline; `null` for the other events or without a rule. */
  counted: number | null;
  /** The rule's `for`; `null` without a rule. */
  of: number | null;
  /** The newest reading of the series, whether it counts or not; `null` without one. */
  latest: number | null;
  /** For `alert-opened`: an alert of the rule was already open at the baseline, so none will open. */
  alreadyOpen: boolean;
}

export type MatchResult =
  | {
      status: 'satisfied';
      /** When it happened (ms), as far as the data says; `null` when it does not say. */
      at: number | null;
      /** The alert it concerns, when it names one. */
      alertId: string | null;
    }
  | { status: 'waiting'; progress: MatchProgress };

const text = (data: Record<string, unknown>, key: string): string | null => {
  const value = data[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
};

const timeOf = (event: ObservationEvent): number | null => {
  const at = Date.parse(event.at);
  return Number.isFinite(at) ? at : null;
};

/** The events after the baseline, newest first. The scan stops at the baseline, so it costs what happened since and not what is kept. */
function* since(events: readonly ObservationEvent[], observationId: number) {
  for (const event of events) {
    if (event.id <= observationId) return;
    yield event;
  }
}

const sameSubject = (event: ObservationEvent, awaited: DemoAwait): boolean =>
  text(event.data, 'ruleId') === awaited.ruleId &&
  text(event.data, 'deviceId') === awaited.deviceId;

/** The readings after the baseline, and how many of them in a row, at the end, are beyond the raise line. */
function ruleRun(baseline: Baseline, inputs: MatchInputs): { run: Sample[] } {
  const rule = inputs.rule;
  if (rule === null) return { run: [] };
  const fresh = inputs.series.filter(
    (sample) => baseline.seriesT === null || sample.t > baseline.seriesT,
  );
  let start = fresh.length;
  for (let i = fresh.length - 1; i >= 0; i--) {
    const sample = fresh[i];
    if (sample === undefined || !isBeyond(rule, sample.v)) break;
    start = i;
  }
  return { run: fresh.slice(start) };
}

/**
 * Has the awaited event happened since the baseline?
 *
 * - `rule-raised` is Studio's own count (ingest does not export its counter): `rule.for` readings in a row beyond the raise
 *   line, among the readings newer than the baseline. A reading back under the line starts the count again.
 * - `alert-opened` and `alert-cleared` are the observations of that name for the awaited rule on the awaited device.
 * - `incident-delivered` is the `incident` observation. It names an alert and not a rule, so it is matched to the alerts the rule
 *   opened since the baseline (`alert-opened` events): the incident of some other rule's alert does not count.
 */
export function matchAwait(
  awaited: DemoAwait,
  baseline: Baseline,
  inputs: MatchInputs,
): MatchResult {
  const from = rebase(baseline, inputs).observationId;
  const latest = inputs.series.at(-1)?.v ?? null;
  const waiting = (extra: Partial<MatchProgress> = {}): MatchResult => ({
    status: 'waiting',
    progress: { counted: null, of: inputs.rule?.for ?? null, latest, alreadyOpen: false, ...extra },
  });

  switch (awaited.type) {
    case 'rule-raised': {
      const rule = inputs.rule;
      if (rule === null) return waiting();
      const { run } = ruleRun(baseline, inputs);
      if (run.length >= rule.for) {
        return { status: 'satisfied', at: run[rule.for - 1]?.t ?? null, alertId: null };
      }
      return waiting({ counted: run.length });
    }
    case 'alert-opened': {
      for (const event of since(inputs.events, from)) {
        if (event.kind === 'alert-opened' && sameSubject(event, awaited)) {
          return { status: 'satisfied', at: timeOf(event), alertId: text(event.data, 'alertId') };
        }
      }
      return waiting({ alreadyOpen: baseline.openAlertIds.length > 0 });
    }
    case 'alert-cleared': {
      for (const event of since(inputs.events, from)) {
        if (event.kind === 'alert-cleared' && sameSubject(event, awaited)) {
          return { status: 'satisfied', at: timeOf(event), alertId: text(event.data, 'alertId') };
        }
      }
      return waiting();
    }
    case 'incident-delivered': {
      const recent = [...since(inputs.events, from)];
      const opened = new Set(
        recent
          .filter((event) => event.kind === 'alert-opened' && sameSubject(event, awaited))
          .map((event) => text(event.data, 'alertId'))
          .filter((id): id is string => id !== null),
      );
      for (const event of recent) {
        const alertId = text(event.data, 'alertId');
        if (event.kind === 'incident' && alertId !== null && opened.has(alertId)) {
          return { status: 'satisfied', at: timeOf(event), alertId };
        }
      }
      return waiting();
    }
  }
}

/** How far the chain of the subject has got since a baseline: what the strip under the step draws, whichever step is on screen. */
export interface Milestones {
  /** Readings in a row beyond the raise line, `null` without a rule. */
  counted: number | null;
  /** The rule's `for`, `null` without a rule. */
  of: number | null;
  /** The rule has raised (Studio's count reached `for`), or an alert of it has opened. */
  ruleRaised: boolean;
  alert: 'none' | 'open' | 'cleared';
  /** An incident has been delivered for an alert the rule opened since the baseline. */
  incident: boolean;
}

const NOT_REACHED: Milestones = {
  counted: null,
  of: null,
  ruleRaised: false,
  alert: 'none',
  incident: false,
};

/**
 * Where the subject's chain stands since `baseline`, by the same matchers the steps use. Without a baseline (the step that starts it
 * has not been entered) nothing has been reached. A clear counts only after an open: an `alert-cleared` for an alert that was open
 * before the baseline is not this run's.
 */
export function milestones(
  subject: { ruleId: string; deviceId: string },
  baseline: Baseline | null,
  inputs: MatchInputs,
): Milestones {
  if (baseline === null) return { ...NOT_REACHED, of: inputs.rule?.for ?? null };
  const at = (type: DemoAwait['type']) =>
    matchAwait({ type, ruleId: subject.ruleId, deviceId: subject.deviceId }, baseline, inputs);

  const raised = at('rule-raised');
  const opened = at('alert-opened');
  const cleared = at('alert-cleared');
  const incident = at('incident-delivered');
  const alertOpened = opened.status === 'satisfied';
  return {
    counted: raised.status === 'waiting' ? raised.progress.counted : (inputs.rule?.for ?? null),
    of: inputs.rule?.for ?? null,
    ruleRaised: raised.status === 'satisfied' || alertOpened,
    alert: alertOpened ? (cleared.status === 'satisfied' ? 'cleared' : 'open') : 'none',
    incident: incident.status === 'satisfied',
  };
}

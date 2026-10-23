import type { Expected, RuleInfo, StateView } from '../api/types';
import type { LinkState } from '../state/store';
import type { MatchProgress } from './demoEvents';
import type { DemoAwait, DemoAwaitType, DemoStep } from './demoScript';
import { metricUnit } from './deviceIdentity';
import { formatAmount } from './rules';

/** The longest a step waits for something nothing predicts (the outbox, an alert right after a rule), in seconds. */
export const DEFAULT_TIMEOUT_S = 60;
/** What is added to the simulator's prediction before a step says it is late, in seconds. */
export const TIMEOUT_MARGIN_S = 30;

const expectedAlert = (expected: Expected | null | undefined, awaited: DemoAwait) =>
  expected?.available === true
    ? expected.alerts.find(
        (alert) => alert.ruleId === awaited.ruleId && alert.deviceId === awaited.deviceId,
      )
    : undefined;

/**
 * How long a step may wait, in seconds, before it says what it is still waiting for. The step's own `timeoutS` wins. Else the
 * simulator's expectation for the scenario (`expected`, worked out from the rules and the publish interval) plus a margin: a step
 * that starts the scenario and waits for the rule is late `opensAtS + 30` seconds after it began; an alert that follows the rule, or an
 * incident that follows the alert, 30 s after; a clear, the time between the open and the clear plus 30. Without a prediction
 * (`expected.available: false`, no alert for this rule, no clear) or for a step that waits for nothing, 60 s.
 */
export function timeoutFor(step: DemoStep, expected: Expected | null | undefined): number {
  if (step.timeoutS !== undefined) return step.timeoutS;
  const awaited = step.await;
  if (awaited === undefined) return DEFAULT_TIMEOUT_S;
  const alert = expectedAlert(expected, awaited);
  if (alert === undefined) return DEFAULT_TIMEOUT_S;

  switch (awaited.type) {
    case 'rule-raised':
      return step.action === undefined ? TIMEOUT_MARGIN_S : alert.opensAtS + TIMEOUT_MARGIN_S;
    case 'alert-opened':
    case 'incident-delivered':
      return TIMEOUT_MARGIN_S;
    case 'alert-cleared':
      return alert.clearsAtS === null
        ? DEFAULT_TIMEOUT_S
        : Math.max(0, alert.clearsAtS - alert.opensAtS) + TIMEOUT_MARGIN_S;
  }
}

/**
 * Seconds from now until the alert should open, from the simulator's prediction and how far into the scenario it is; `null` when it
 * predicts none. Zero once the time has passed ("about 0 s" is "any moment now", said by the caller).
 */
export function alertOpensIn(
  expected: Expected | null | undefined,
  awaited: DemoAwait,
  elapsedS: number,
): number | null {
  const alert = expectedAlert(expected, awaited);
  return alert === undefined ? null : Math.max(0, Math.round(alert.opensAtS - elapsedS));
}

/** What a step waits for, as the end of "Waiting for …". */
export function waitingSentence(awaited: DemoAwait): string {
  const { ruleId, deviceId } = awaited;
  switch (awaited.type) {
    case 'rule-raised':
      return `the rule ${ruleId} to raise on ${deviceId}`;
    case 'alert-opened':
      return `the alert of ${ruleId} on ${deviceId} to open`;
    case 'incident-delivered':
      return `the incident for the alert of ${ruleId} on ${deviceId} to reach the Command Center`;
    case 'alert-cleared':
      return `the alert of ${ruleId} on ${deviceId} to clear`;
  }
}

/**
 * The rule's count under "Waiting for the rule to raise": "server-room-hot has 2 of 3 readings above 27 °C". Only for a step that waits
 * for the rule, and only when Studio has a rule and a count; `null` otherwise.
 */
export function countSentence(
  awaited: DemoAwait,
  rule: RuleInfo | null,
  progress: MatchProgress | null,
): string | null {
  if (awaited.type !== 'rule-raised' || rule === null || progress === null) return null;
  if (progress.counted === null || progress.of === null) return null;
  const unit = metricUnit(rule.metric);
  const line = `${formatAmount(rule.raise)}${unit === '' ? '' : ` ${unit}`}`;
  const side = rule.direction === 'above' ? 'above' : 'below';
  return `${awaited.ruleId} has ${progress.counted} of ${progress.of} readings ${side} ${line}`;
}

/** What happened, for the line that says a step moved on by itself ("Moved on: the alert opened"). */
export const happenedSentence: Record<DemoAwaitType, string> = {
  'rule-raised': 'the rule raised',
  'alert-opened': 'the alert opened',
  'incident-delivered': 'the incident was delivered',
  'alert-cleared': 'the alert cleared',
};

/** The label of the way on once a step is late: what the presenter chooses to do without. */
export const moveOnLabel: Record<DemoAwaitType, string> = {
  'rule-raised': 'Move on without the rule',
  'alert-opened': 'Move on without the alert',
  'incident-delivered': 'Move on without the incident',
  'alert-cleared': 'Move on without the clear',
};

export type CauseCode =
  | 'link-lost'
  | 'ingest-unreachable'
  | 'ingest-not-ready'
  | 'no-command-center'
  | 'rules-unavailable'
  | 'engine-stopped'
  | 'device-not-running'
  | 'simulated-clock'
  | 'already-open';

export interface Cause {
  code: CauseCode;
  /** A sentence for the audience of a demo: what is wrong, and what to do when there is something. */
  text: string;
}

export interface CauseInputs {
  link: LinkState;
  /** The last state the simulator sent, `null` before the first. */
  view: StateView | null;
  awaited: DemoAwait;
  /** An alert of the awaited rule was already open when the step began (`MatchProgress.alreadyOpen`). */
  alreadyOpen: boolean;
}

/**
 * The one thing Studio can see that explains why the awaited event is not coming, in this order: the link to the simulator, ingest,
 * the command center (only for an incident), the rules, the engine and the device, the simulated clock, an alert that was already
 * open. One cause and not a list: a presenter has a sentence to say, not a checklist to read. `null` when nothing explains it.
 */
export function likelyCause({ link, view, awaited, alreadyOpen }: CauseInputs): Cause | null {
  if (link === 'lost') {
    return {
      code: 'link-lost',
      text: 'Studio has lost the link to the simulator, so what it shows may be old.',
    };
  }
  if (view === null) return null;

  const { ingest } = view;
  if (ingest.status === 'unreachable') {
    return {
      code: 'ingest-unreachable',
      text: 'Ingest does not answer, so no alert can open. Start it, or move on.',
    };
  }
  if (ingest.status === 'not-ready') {
    return {
      code: 'ingest-not-ready',
      text: 'Ingest says it is not ready (its database or its broker is down).',
    };
  }
  if (awaited.type === 'incident-delivered' && ingest.alertSink === 'none') {
    return {
      code: 'no-command-center',
      text: 'Ingest has no command center configured (OCC_API_URL is not set), so no incident will be delivered.',
    };
  }
  if (!view.rules.available) {
    return {
      code: 'rules-unavailable',
      text: `The simulator has no rules to read${view.rules.reason === null ? '' : `: ${view.rules.reason}`}.`,
    };
  }
  if (!view.engine.running) {
    return { code: 'engine-stopped', text: 'The engine is stopped, so no device is publishing.' };
  }
  const device = view.engine.devices.find((entry) => entry.id === awaited.deviceId);
  if (device === undefined) {
    return {
      code: 'device-not-running',
      text: `${awaited.deviceId} is not in the registry, so nothing is published for it.`,
    };
  }
  if (device.state !== 'running') {
    return {
      code: 'device-not-running',
      text: `${awaited.deviceId} is ${device.state}, so it publishes nothing. Resume it, or move on.`,
    };
  }
  if (view.engine.simulated) {
    return {
      code: 'simulated-clock',
      text: 'The simulator runs on the simulated clock: nothing is published until you press Step on the Overview.',
    };
  }
  if (awaited.type === 'alert-opened' && alreadyOpen) {
    return {
      code: 'already-open',
      text: `An alert for ${awaited.ruleId} on ${awaited.deviceId} was already open before this step, so no new one will open.`,
    };
  }
  return null;
}

export interface StartNotice {
  code: CauseCode;
  tone: 'warn' | 'info';
  text: string;
}

export interface StartInputs {
  link: LinkState;
  view: StateView | null;
  /** What ingest last said about its alert sink; kept while ingest is unreachable (`StudioState.lastAlertSink`). */
  lastAlertSink: string | null;
}

/**
 * What would stop the whole script, for the start screen: a presenter should learn it before step 3 and not a minute into it.
 * Nothing for a state that has not arrived yet.
 */
export function startNotices({ link, view, lastAlertSink }: StartInputs): StartNotice[] {
  if (view === null) return [];
  const notices: StartNotice[] = [];
  if (link === 'lost') {
    notices.push({
      code: 'link-lost',
      tone: 'warn',
      text: 'Studio has lost the link to the simulator. Nothing here can be started until it is back.',
    });
  }
  if (view.ingest.status === 'unreachable') {
    notices.push({
      code: 'ingest-unreachable',
      tone: 'warn',
      text: 'Ingest does not answer, so no alert will open. Start ingest first.',
    });
  } else if (view.ingest.status === 'not-ready') {
    notices.push({
      code: 'ingest-not-ready',
      tone: 'warn',
      text: 'Ingest says it is not ready (its database or its broker is down).',
    });
  }
  if ((view.ingest.alertSink ?? lastAlertSink) === 'none') {
    notices.push({
      code: 'no-command-center',
      tone: 'warn',
      text: 'Ingest has no command center configured (OCC_API_URL is not set): alerts will open, but no incident will appear.',
    });
  }
  if (!view.rules.available) {
    notices.push({
      code: 'rules-unavailable',
      tone: 'warn',
      text: `The simulator has no rules to read${view.rules.reason === null ? '' : `: ${view.rules.reason}`}.`,
    });
  }
  if (view.engine.simulated) {
    notices.push({
      code: 'simulated-clock',
      tone: 'warn',
      text: 'The simulator runs on the simulated clock: nothing is published by itself, so the steps that wait will not finish until you press Step on the Overview.',
    });
  }
  return notices;
}

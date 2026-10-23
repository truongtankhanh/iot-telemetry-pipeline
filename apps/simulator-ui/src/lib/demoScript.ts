import { rangeOf } from './rules';

/** The events a step can wait for: the four the ticket names. A later ticket may add to the list (a camera step is an action, not an event). */
export const DEMO_AWAIT_TYPES = [
  'rule-raised',
  'alert-opened',
  'incident-delivered',
  'alert-cleared',
] as const;

export type DemoAwaitType = (typeof DEMO_AWAIT_TYPES)[number];

/** What a step waits for, and for which rule on which device. */
export interface DemoAwait {
  type: DemoAwaitType;
  ruleId: string;
  deviceId: string;
}

/** What a step does when it begins. A union, so a new kind of action extends it without changing the code that reads the others. */
export type DemoAction =
  | { type: 'run-scenario'; scenario: string }
  | { type: 'hold-value'; deviceId: string; metric: string; value: number };

export interface DemoStep {
  /** Unique in the script; the key of a step in the session. */
  id: string;
  title: string;
  /** The line under the title in the step list. May carry `{tokens}`. */
  summary: string;
  /** What the presenter says, shown large. May carry `{tokens}`. */
  say: string;
  action?: DemoAction;
  await?: DemoAwait;
  /** Seconds a step may wait before it says what it is still waiting for; derived from the scenario's expectation when absent. */
  timeoutS?: number;
  /** For the presenter only, behind `N`. */
  notes?: string;
}

/** The object of the script's `{tokens}`: the device, the metric and the rule it is about. */
export interface DemoSubject {
  deviceId: string;
  metric: string;
  ruleId: string;
}

export interface DemoScript {
  id: string;
  title: string;
  summary: string;
  subject: DemoSubject;
  /** The scenario the script plays; its anomaly of the subject gives `{value}` and `{duration}`. */
  scenario: string;
  steps: DemoStep[];
}

/** The `{tokens}` a text may carry (`lib/demoText.ts` fills them). A token that is not here is a mistake in the script. */
export const DEMO_TOKENS = [
  'devices',
  'rate',
  'rule.raise',
  'rule.clear',
  'rule.for',
  'rule.metric',
  'device',
  'value',
  'duration',
  'scenario',
] as const;

export type DemoToken = (typeof DEMO_TOKENS)[number];

/** A token looks like `{rule.raise}`; braces around anything else are plain text. */
export const TOKEN_PATTERN = /\{([a-z][a-z.]*)\}/g;

/** The tokens a text uses, in order, each time it uses one. */
export function tokensIn(text: string): string[] {
  return [...text.matchAll(TOKEN_PATTERN)].map((match) => match[1] as string);
}

export type ScriptValidation = { ok: true; script: DemoScript } | { ok: false; problems: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Checks a script that came from anywhere (a constant today, a file one day) and says what is wrong in a sentence that
 * names the step, instead of letting the page fail on stage. Every problem is reported, not only the first.
 */
export function validateScript(raw: unknown): ScriptValidation {
  const problems: string[] = [];
  if (!isRecord(raw)) return { ok: false, problems: ['The script is not an object.'] };

  const text = (record: Record<string, unknown>, key: string, where: string): string => {
    const value = record[key];
    if (!isText(value)) {
      problems.push(`${where} needs a non-empty "${key}".`);
      return '';
    }
    return value;
  };
  const checkTokens = (value: string, where: string) => {
    for (const token of tokensIn(value)) {
      if (!(DEMO_TOKENS as readonly string[]).includes(token)) {
        problems.push(`${where} uses the unknown token {${token}}.`);
      }
    }
  };

  const id = text(raw, 'id', 'The script');
  const title = text(raw, 'title', 'The script');
  const summary = text(raw, 'summary', 'The script');
  const scenario = text(raw, 'scenario', 'The script');

  let subject: DemoSubject = { deviceId: '', metric: '', ruleId: '' };
  if (!isRecord(raw.subject)) {
    problems.push('The script needs a "subject" with a deviceId, a metric and a ruleId.');
  } else {
    subject = {
      deviceId: text(raw.subject, 'deviceId', 'The subject'),
      metric: text(raw.subject, 'metric', 'The subject'),
      ruleId: text(raw.subject, 'ruleId', 'The subject'),
    };
  }

  const steps: DemoStep[] = [];
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    problems.push('The script needs at least one step.');
  } else {
    const seen = new Set<string>();
    raw.steps.forEach((entry: unknown, index) => {
      const fallback = `Step ${index + 1}`;
      if (!isRecord(entry)) {
        problems.push(`${fallback} is not an object.`);
        return;
      }
      const stepId = isText(entry.id) ? entry.id : null;
      const where = stepId === null ? fallback : `Step "${stepId}"`;
      if (stepId === null) problems.push(`${fallback} needs an "id".`);
      else if (seen.has(stepId)) problems.push(`${where} has an id that another step has.`);
      else seen.add(stepId);

      const stepTitle = text(entry, 'title', where);
      const stepSummary = text(entry, 'summary', where);
      const say = text(entry, 'say', where);
      checkTokens(stepTitle, where);
      checkTokens(stepSummary, where);
      checkTokens(say, where);

      const step: DemoStep = { id: stepId ?? '', title: stepTitle, summary: stepSummary, say };

      if (entry.notes !== undefined) {
        if (typeof entry.notes === 'string') {
          checkTokens(entry.notes, where);
          step.notes = entry.notes;
        } else {
          problems.push(`${where} has notes that are not text.`);
        }
      }

      if (entry.timeoutS !== undefined) {
        if (
          typeof entry.timeoutS === 'number' &&
          Number.isFinite(entry.timeoutS) &&
          entry.timeoutS > 0
        ) {
          step.timeoutS = entry.timeoutS;
        } else {
          problems.push(`${where} needs a "timeoutS" above zero.`);
        }
      }

      if (entry.action !== undefined) {
        const action = readAction(entry.action, where, problems);
        if (action !== null) step.action = action;
      }

      if (entry.await !== undefined) {
        const awaited = readAwait(entry.await, where, problems);
        if (awaited !== null) step.await = awaited;
      }

      steps.push(step);
    });
  }

  checkTokens(title, 'The script');
  checkTokens(summary, 'The script');

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, script: { id, title, summary, subject, scenario, steps } };
}

function readAction(raw: unknown, where: string, problems: string[]): DemoAction | null {
  if (!isRecord(raw)) {
    problems.push(`${where} has an action that is not an object.`);
    return null;
  }
  if (raw.type === 'run-scenario') {
    if (!isText(raw.scenario)) {
      problems.push(`${where} runs a scenario but names none.`);
      return null;
    }
    return { type: 'run-scenario', scenario: raw.scenario };
  }
  if (raw.type === 'hold-value') {
    if (!isText(raw.deviceId) || !isText(raw.metric)) {
      problems.push(`${where} holds a value but names no device or metric.`);
      return null;
    }
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
      problems.push(`${where} holds a value that is not a finite number.`);
      return null;
    }
    const range = rangeOf(raw.metric);
    if (range === null) {
      problems.push(`${where} holds a metric the contract does not have: ${raw.metric}.`);
      return null;
    }
    if (raw.value < range.min || raw.value > range.max) {
      problems.push(
        `${where} holds ${raw.value}, outside the contract's range ${range.min} to ${range.max} for ${raw.metric}.`,
      );
      return null;
    }
    return { type: 'hold-value', deviceId: raw.deviceId, metric: raw.metric, value: raw.value };
  }
  problems.push(`${where} has an action of an unknown type: ${String(raw.type)}.`);
  return null;
}

function readAwait(raw: unknown, where: string, problems: string[]): DemoAwait | null {
  if (!isRecord(raw)) {
    problems.push(`${where} has an await that is not an object.`);
    return null;
  }
  const type = (DEMO_AWAIT_TYPES as readonly unknown[]).includes(raw.type)
    ? (raw.type as DemoAwaitType)
    : null;
  if (type === null) {
    problems.push(`${where} waits for an event of an unknown type: ${String(raw.type)}.`);
    return null;
  }
  if (!isText(raw.ruleId) || !isText(raw.deviceId)) {
    problems.push(`${where} waits for ${type} but names no rule or device.`);
    return null;
  }
  return { type, ruleId: raw.ruleId, deviceId: raw.deviceId };
}

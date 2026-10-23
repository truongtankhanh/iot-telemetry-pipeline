import type { RuleInfo, ScenarioItem } from '../api/types';
import { type DemoSubject, TOKEN_PATTERN } from './demoScript';
import { metricUnit } from './deviceIdentity';
import { formatAmount, formatValue } from './rules';

/** What the tokens of a script read: facts of the stack, so the text never goes stale when `rules.json` or a scenario changes. */
export interface DemoFacts {
  /** How many devices the registry has, or `null` before the first state. */
  devices: number | null;
  /** Messages per second on the stream, or `null` when it is not known. */
  rate: number | null;
  /** The rule the script is about, or `null` when the simulator has no rules. */
  rule: RuleInfo | null;
  /** The scenario the script plays, or `null` before the library has loaded. */
  scenario: ScenarioItem | null;
  subject: DemoSubject;
}

/** What a token says when its fact is missing: plain words, never `undefined` or `NaN`. */
const FALLBACK: Record<string, string> = {
  devices: 'the devices',
  rate: 'the current rate',
  'rule.raise': 'the raise line',
  'rule.clear': 'the clear line',
  'rule.for': 'a few',
  'rule.metric': 'the metric',
  device: 'the device',
  value: 'the value',
  duration: 'a while',
  scenario: 'the scenario',
};

const withUnit = (metric: string, text: string): string => {
  const unit = metricUnit(metric);
  return unit === '' ? text : `${text} ${unit}`;
};

/** The subject's anomaly in the scenario: what `{value}` and `{duration}` are read from. */
function anomalyOf(facts: DemoFacts) {
  return facts.scenario?.anomalies.find(
    (anomaly) =>
      anomaly.deviceId === facts.subject.deviceId && anomaly.metric === facts.subject.metric,
  );
}

function valueOf(token: string, facts: DemoFacts): string | null {
  switch (token) {
    case 'devices':
      return facts.devices === null
        ? null
        : `${facts.devices} ${facts.devices === 1 ? 'device' : 'devices'}`;
    case 'rate':
      return facts.rate !== null && Number.isFinite(facts.rate)
        ? `${facts.rate.toFixed(1)} msg/s`
        : null;
    case 'rule.raise':
      return facts.rule === null
        ? null
        : withUnit(facts.rule.metric, formatAmount(facts.rule.raise));
    case 'rule.clear':
      return facts.rule === null
        ? null
        : withUnit(facts.rule.metric, formatAmount(facts.rule.clear));
    case 'rule.for':
      return facts.rule === null ? null : String(facts.rule.for);
    case 'rule.metric':
      return facts.rule === null ? null : facts.rule.metric;
    case 'device':
      return facts.subject.deviceId;
    case 'value': {
      const anomaly = anomalyOf(facts);
      return anomaly === undefined
        ? null
        : withUnit(anomaly.metric, formatValue(anomaly.metric, anomaly.value));
    }
    case 'duration': {
      const anomaly = anomalyOf(facts);
      return anomaly === undefined ? null : `${anomaly.duration} s`;
    }
    case 'scenario':
      return facts.scenario === null ? null : facts.scenario.name;
    default:
      return null;
  }
}

/**
 * Fills the `{tokens}` of a script's text from the facts. A token whose fact is missing says a plain fallback; a brace
 * that is not a known token is left as it is (the validator refuses an unknown token before a script is ever shown).
 */
export function fillText(text: string, facts: DemoFacts): string {
  return text.replace(TOKEN_PATTERN, (whole, token: string) => {
    if (!Object.hasOwn(FALLBACK, token)) return whole;
    return valueOf(token, facts) ?? (FALLBACK[token] as string);
  });
}

/** Seconds a presenter is taken to need for the narration of one step, in the estimate of how long a script takes. */
export const NARRATION_S_PER_STEP = 20;

/**
 * "Script: overheat-to-incident · 6 steps · about 4 min". The time is an estimate: the scenario's length plus the narration of each step.
 * It is worked out from the scenario in the library, so it follows the scenario when that changes; without the scenario it is left out.
 */
export function scriptLine(
  script: { id: string; steps: readonly unknown[] },
  scenario: Pick<ScenarioItem, 'lengthS'> | null,
): string {
  const count = script.steps.length;
  const steps = `${count} ${count === 1 ? 'step' : 'steps'}`;
  const minutes =
    scenario === null
      ? null
      : Math.max(1, Math.ceil((scenario.lengthS + NARRATION_S_PER_STEP * count) / 60));
  return `Script: ${script.id} · ${steps}${minutes === null ? '' : ` · about ${minutes} min`}`;
}

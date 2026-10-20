import type { PagedAlert, RuleInfo, RulesView } from '../api/types';
import type { Sample } from '../state/history';
import { metricUnit } from './deviceIdentity';
import { formatAmount, formatValue } from './rules';
import { breachRun } from './topologyDetail';

/** The rule behind an alert, or `null` when the rules are not available or ingest has a rule Studio has not read. */
export function ruleOf(rules: RulesView, alert: Pick<PagedAlert, 'ruleId'>): RuleInfo | null {
  if (!rules.available) return null;
  return rules.items.find((rule) => rule.id === alert.ruleId) ?? null;
}

export interface AlertWhy {
  /** Why the rule raised it, in a sentence. */
  text: string;
  /** The breaching readings Studio recorded that led to it, oldest first; empty when it holds none. */
  readings: number[];
  /** "Injected by the scenario <name> started in Studio.", only when the simulator names one; else `null`. */
  cause: string | null;
}

const withUnit = (metric: string, text: string) => {
  const unit = metricUnit(metric);
  return unit === '' ? text : `${text} ${unit}`;
};

const readingsPhrase = (rule: RuleInfo) =>
  rule.for === 1 ? '' : ` for ${rule.for} readings in a row`;

/**
 * Why the alert exists (frame 13, "Why"). The rule and its line come from the rules Studio read at boot; the readings
 * are the breaching ones Studio recorded up to the moment ingest opened the alert (it keeps two minutes), and when it
 * holds fewer than the rule needs the sentence falls back to the value ingest stored. The cause is only what the
 * simulator says (`alert.cause`): nothing here guesses a scenario, and an alert with no cause says nothing about one.
 */
export function alertWhy({
  alert,
  rule,
  series,
}: {
  alert: PagedAlert;
  rule: RuleInfo | null;
  /** The history of the alert's metric for its device. */
  series: readonly Sample[];
}): AlertWhy {
  const cause =
    alert.cause === null
      ? null
      : `Injected by the scenario ${alert.cause.scenario} started in Studio.`;
  const opened =
    alert.openedValue === null
      ? null
      : withUnit(alert.metric, formatValue(alert.metric, alert.openedValue));

  if (rule === null) {
    const at = opened === null ? '' : `, ${alert.metric} ${opened}`;
    return {
      text: `Rule ${alert.ruleId} raised it on ${alert.deviceId}${at}. The rule's thresholds are not available to Studio.`,
      readings: [],
      cause,
    };
  }

  const line = `${alert.deviceId} ${alert.metric} was ${rule.direction} ${withUnit(rule.metric, formatAmount(rule.raise))}${readingsPhrase(rule)}`;
  const openedMs = Date.parse(alert.openedAt);
  const before = Number.isFinite(openedMs) ? series.filter((sample) => sample.t <= openedMs) : [];
  const run = breachRun(before, rule);
  if (run.length >= rule.for) {
    const readings = run.slice(-rule.for).map((sample) => sample.v);
    const list = readings.map((value) => formatValue(rule.metric, value)).join(', ');
    return { text: `${line} (${list}).`, readings, cause };
  }
  return {
    text: `${line}.${opened === null ? '' : ` It opened at ${opened}.`} Studio did not record the readings that led to it.`,
    readings: [],
    cause,
  };
}

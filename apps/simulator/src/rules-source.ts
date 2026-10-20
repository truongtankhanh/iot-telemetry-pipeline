import { METRIC_NAMES, type MetricName } from '@itp/telemetry-contract';
import { readFileSync } from 'node:fs';

export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low';

/** One threshold rule, as Studio draws it: the part of an ingest rule that the charts and the range bar read. */
export interface RuleInfo {
  id: string;
  /** Device kind the rule applies to. */
  kind: string;
  metric: MetricName;
  direction: 'above' | 'below';
  /** The value that counts as a breach (strictly beyond it). */
  raise: number;
  /** The value an open alert must get back past to clear: the hysteresis band lies between the two. */
  clear: number;
  /** Consecutive breaching readings needed to open an alert. */
  for: number;
  severity: RuleSeverity;
  title: string;
}

/** What `GET /api/state` says about the rules: the list, or why there is none. */
export interface RulesView {
  available: boolean;
  /** Why the rules are not available, in words; `null` when they are. */
  reason: string | null;
  items: RuleInfo[];
}

const SEVERITIES: RuleSeverity[] = ['low', 'medium', 'high', 'critical'];

/**
 * Validates the content of `rules.json`. The checks are those of `parseRules` in
 * `apps/ingest/src/rules/rules-engine.ts` (that module is NestJS and is not imported here), except that
 * a metric is checked against the telemetry contract, not against the registry's device kinds, and that
 * `incidentType`, which only the command center reads, is not required. Throws an `Error` that names the
 * rule and the field.
 */
export function parseRules(input: unknown): RuleInfo[] {
  const list = (input as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(list)) throw new Error('"rules" must be an array');
  const ids = new Set<string>();

  return list.map((raw: unknown, index) => {
    const rule = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const where = `rules[${index}]${typeof rule.id === 'string' && rule.id ? ` (${rule.id})` : ''}`;

    for (const key of ['id', 'kind', 'metric', 'title'] as const) {
      if (typeof rule[key] !== 'string' || rule[key] === '') {
        throw new Error(`${where}.${key} is required`);
      }
    }
    const id = rule.id as string;
    if (ids.has(id)) throw new Error(`${where}: duplicate id`);
    ids.add(id);

    const metric = rule.metric as string;
    if (!METRIC_NAMES.includes(metric as MetricName)) {
      throw new Error(`${where}: unknown metric "${metric}"`);
    }
    if (rule.direction !== 'above' && rule.direction !== 'below') {
      throw new Error(`${where}.direction must be above or below`);
    }
    const { raise, clear } = rule;
    if (
      typeof raise !== 'number' ||
      typeof clear !== 'number' ||
      !Number.isFinite(raise) ||
      !Number.isFinite(clear)
    ) {
      throw new Error(`${where}: raise and clear must be numbers`);
    }
    const bandOk = rule.direction === 'above' ? clear <= raise : clear >= raise;
    if (!bandOk) throw new Error(`${where}: clear must be on the safe side of raise`);
    const count = rule.for;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      throw new Error(`${where}.for must be a positive integer`);
    }
    if (!SEVERITIES.includes(rule.severity as RuleSeverity)) {
      throw new Error(`${where}.severity is invalid`);
    }

    return {
      id,
      kind: rule.kind as string,
      metric: metric as MetricName,
      direction: rule.direction,
      raise,
      clear,
      for: count,
      severity: rule.severity as RuleSeverity,
      title: rule.title as string,
    };
  });
}

/** The answer when there are no rules to show, with the reason. */
export const rulesUnavailable = (reason: string): RulesView => ({
  available: false,
  reason,
  items: [],
});

/**
 * Reads and validates a rules file. It never throws: a missing or invalid file is a state Studio
 * reports ("Rules are not available: …") and hides what depends on, not a reason to stop publishing.
 */
export function loadRules(path: string): RulesView {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return rulesUnavailable(`cannot read ${path}${code ? ` (${code})` : ''}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return rulesUnavailable(`${path} is not valid JSON`);
  }
  try {
    return { available: true, reason: null, items: parseRules(json) };
  } catch (error) {
    return rulesUnavailable(
      `${path} is not usable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

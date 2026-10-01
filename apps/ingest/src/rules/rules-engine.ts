import type { MetricName } from '@itp/telemetry-contract';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Rule {
  id: string;
  /** Device kind the rule applies to. */
  kind: string;
  metric: MetricName;
  direction: 'above' | 'below';
  /** Value that counts as a breach (strictly beyond it). */
  raise: number;
  /** Value an open alert must get back past to clear — the hysteresis band. */
  clear: number;
  /** Consecutive breaching readings needed to open an alert. */
  for: number;
  severity: Severity;
  /** Incident type to use in the command center. */
  incidentType: string;
  title: string;
}

export interface RuleState {
  open: boolean;
  /** Consecutive breaching readings while closed. */
  streak: number;
}

export type Transition = 'opened' | 'cleared' | null;

export const INITIAL_STATE: RuleState = { open: false, streak: 0 };

/**
 * Pure rule evaluation (ADR-0004). Opens after `rule.for` consecutive breaches; clears only once
 * the value is back past `rule.clear`, so a value hovering at the threshold cannot flap.
 */
export function evaluate(
  rule: Rule,
  state: RuleState,
  value: number,
): { state: RuleState; transition: Transition } {
  const beyond = (limit: number) => (rule.direction === 'above' ? value > limit : value < limit);
  const backWithin = (limit: number) =>
    rule.direction === 'above' ? value < limit : value > limit;

  if (state.open) {
    return backWithin(rule.clear)
      ? { state: { open: false, streak: 0 }, transition: 'cleared' }
      : { state, transition: null };
  }

  const streak = beyond(rule.raise) ? state.streak + 1 : 0;
  return streak >= rule.for
    ? { state: { open: true, streak: 0 }, transition: 'opened' }
    : { state: { open: false, streak }, transition: null };
}

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

/** Validates `rules.json` against the registered device kinds and their metrics. */
export function parseRules(input: unknown, kinds: Map<string, Set<string>>): Rule[] {
  const list = (input as { rules?: unknown })?.rules;
  if (!Array.isArray(list)) throw new Error('rules.json: "rules" must be an array');
  const ids = new Set<string>();

  return list.map((raw, i) => {
    const r = raw as Partial<Rule>;
    const where = `rules.json: rules[${i}]${r.id ? ` (${r.id})` : ''}`;
    for (const key of ['id', 'kind', 'metric', 'incidentType', 'title'] as const) {
      if (typeof r[key] !== 'string' || !r[key]) throw new Error(`${where}.${key} is required`);
    }
    if (ids.has(r.id!)) throw new Error(`${where}: duplicate id`);
    ids.add(r.id!);
    const metrics = kinds.get(r.kind!);
    if (!metrics) throw new Error(`${where}: no device has kind "${r.kind}"`);
    if (!metrics.has(r.metric!))
      throw new Error(`${where}: kind "${r.kind}" never reports ${r.metric}`);
    if (r.direction !== 'above' && r.direction !== 'below')
      throw new Error(`${where}.direction must be above or below`);
    if (typeof r.raise !== 'number' || typeof r.clear !== 'number')
      throw new Error(`${where}: raise and clear must be numbers`);
    const bandOk = r.direction === 'above' ? r.clear <= r.raise : r.clear >= r.raise;
    if (!bandOk) throw new Error(`${where}: clear must be on the safe side of raise`);
    if (!Number.isInteger(r.for) || r.for! < 1)
      throw new Error(`${where}.for must be a positive integer`);
    if (!SEVERITIES.includes(r.severity as Severity))
      throw new Error(`${where}.severity is invalid`);
    return r as Rule;
  });
}

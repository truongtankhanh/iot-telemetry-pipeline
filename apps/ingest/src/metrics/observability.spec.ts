import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Histogram, type Registry } from 'prom-client';
import { Metrics } from './metrics';

/**
 * The Prometheus rules in `deploy/observability/prometheus/alerts.yml` against the service and
 * against the "Suggested alerts" table of `docs/operations.md`. A rule that names a metric the
 * service does not export never fires, and a table that disagrees with the file misleads whoever
 * reads it, and neither shows up until an incident. Like `platform-aws.contract.spec.ts`, the
 * lookups below are deliberately crude (there is no YAML parser): they rely on the layout the file
 * promises, and fail loudly, naming what they could not find, when it changes.
 *
 * The layout of a rule, as the file writes it: `- alert: Name`, then `expr: |-` followed by exactly
 * one indented line, then `for`, `labels.severity` and the `summary` and `description` annotations.
 */
const ROOT = join(__dirname, '../../../..');
const RULES_PATH = join(ROOT, 'deploy/observability/prometheus/alerts.yml');
const OPERATIONS_PATH = join(ROOT, 'docs/operations.md');

const registry = new Metrics().registry;

/** Every metric name the text mentions: the service's own prefixes and the default process metrics. */
function metricNames(text: string): string[] {
  return [...new Set(text.match(/\b(?:telemetry|alerts?|process|nodejs)_[a-z0-9_]+/g) ?? [])];
}

/**
 * The names the registry does not export. A histogram is queried through `_bucket`, `_sum` and
 * `_count`, so those suffixes are accepted, but only when what is left is a registered histogram.
 */
function unknownMetrics(names: string[], metrics: Registry): string[] {
  return names.filter((name) => {
    if (metrics.getSingleMetric(name)) return false;
    const suffix = /_(?:bucket|sum|count)$/.exec(name);
    const base = suffix ? metrics.getSingleMetric(name.slice(0, -suffix[0].length)) : undefined;
    return !(base instanceof Histogram);
  });
}

interface Rule {
  alert: string;
  /** Empty when the rule does not follow the layout above. */
  expr: string;
  for?: string;
  severity?: string;
  summary?: string;
  description?: string;
}

/** The rules of the file, one per `- alert:` entry. */
function parseRules(text: string): Rule[] {
  return text
    .split(/^\s*- alert:\s*/m)
    .slice(1)
    .map((block) => ({
      alert: block.split('\n')[0]!.trim(),
      expr: /^\s+expr: \|-\n\s+(\S.*)\n\s+for:/m.exec(block)?.[1]?.trim() ?? '',
      for: /^\s+for:\s*(\S+)/m.exec(block)?.[1],
      severity: /^\s+severity:\s*(\S+)/m.exec(block)?.[1],
      summary: /^\s+summary:\s*(\S.*)$/m.exec(block)?.[1],
      description: /^\s+description:\s*(\S.*)$/m.exec(block)?.[1],
    }));
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * The expression of every row of the "Suggested alerts" table: the one backticked span of the first
 * cell. A row with a second span or with a stray `|` is refused rather than guessed at.
 */
function tableExpressions(markdown: string): string[] {
  const start = markdown.indexOf('### Suggested alerts');
  if (start < 0) throw new Error('docs/operations.md no longer has "### Suggested alerts"');
  const rest = markdown.slice(start + '### Suggested alerts'.length);
  const end = rest.search(/^#{1,3} /m);
  const section = end < 0 ? rest : rest.slice(0, end);

  const rows = section.split('\n').filter((line) => line.startsWith('|'));
  // The header and the separator line are not rules.
  return rows.slice(2).map((row) => {
    const cells = row.split('|');
    if (cells.length !== 4)
      throw new Error(`The table row has a stray "|" or a missing cell: ${row}`);
    const spans = [...cells[1]!.matchAll(/`([^`]+)`/g)];
    if (spans.length !== 1) {
      throw new Error(`The first cell must hold exactly one expression in backticks: ${row}`);
    }
    return collapse(spans[0]![1]!);
  });
}

describe('Prometheus alert rules', () => {
  const rules = (): Rule[] => parseRules(readFileSync(RULES_PATH, 'utf8'));

  it('uses only metrics the service exports', () => {
    const names = metricNames(readFileSync(RULES_PATH, 'utf8'));
    // Guards the lookup itself: a pattern that matches nothing would make the check below vacuous.
    expect(names.length).toBeGreaterThan(0);

    expect(unknownMetrics(names, registry)).toEqual([]);
  });

  it('would notice a misspelled metric, and accepts a histogram only through its own suffixes', () => {
    const typo = metricNames('increase(telemetry_flush_retrys_total[5m]) > 0');
    expect(typo).toEqual(['telemetry_flush_retrys_total']);
    expect(unknownMetrics(typo, registry)).toEqual(typo);

    expect(unknownMetrics(['telemetry_ingest_lag_seconds_bucket'], registry)).toEqual([]);
    // A counter is not a histogram: a suffix after its name does not make a metric.
    expect(unknownMetrics(['telemetry_messages_total_count'], registry)).toEqual([
      'telemetry_messages_total_count',
    ]);
  });

  it('has one rule for each row of the table, each with its own PascalCase name', () => {
    const names = rules().map((rule) => rule.alert);
    const rows = tableExpressions(readFileSync(OPERATIONS_PATH, 'utf8'));
    // Guards the lookups: finding no rule and no row at all would make the check below vacuous.
    expect(names.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);

    expect(names).toHaveLength(rows.length);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => !/^[A-Z][A-Za-z0-9]+$/.test(name))).toEqual([]);
  });

  it('has, for every row of the table, a rule with the same expression, and no other', () => {
    const fromFile = rules().map((rule) => collapse(rule.expr));
    const fromTable = tableExpressions(readFileSync(OPERATIONS_PATH, 'utf8'));

    expect(fromFile.sort()).toEqual(fromTable.sort());
  });

  it('gives every rule an expression on one line, a duration, a severity and both annotations', () => {
    const problems = rules().flatMap((rule) => {
      const missing: string[] = [];
      if (rule.expr === '') missing.push('expr (`expr: |-` and one line, then `for:`)');
      if (!/^\d+[smh]$/.test(rule.for ?? '')) missing.push('for');
      if (!['critical', 'warning'].includes(rule.severity ?? '')) missing.push('severity');
      if (!rule.summary) missing.push('summary');
      if (!rule.description) missing.push('description');
      return missing.map((what) => `${rule.alert}: ${what}`);
    });

    expect(problems).toEqual([]);
  });

  it('names no job and no instance: the scrape configuration of a site decides those', () => {
    const named = rules().filter((rule) => /\b(?:job|instance)\b/.test(rule.expr));

    expect(named.map((rule) => rule.alert)).toEqual([]);
  });
});

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
 *
 * The Grafana dashboard in `deploy/observability/grafana/telemetry-ingest.json` gets the same check
 * on its queries: a panel that names a metric or a label the service does not have shows nothing,
 * and no error says so.
 */
const ROOT = join(__dirname, '../../../..');
const RULES_PATH = join(ROOT, 'deploy/observability/prometheus/alerts.yml');
const OPERATIONS_PATH = join(ROOT, 'docs/operations.md');
const DASHBOARD_PATH = join(ROOT, 'deploy/observability/grafana/telemetry-ingest.json');

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

/** The part of a Grafana dashboard the checks below read. */
interface Panel {
  id?: number;
  type?: string;
  datasource?: { uid?: string };
  targets?: { expr?: string }[];
  /** A collapsed row nests its panels. */
  panels?: Panel[];
}
interface Variable {
  name?: string;
  type?: string;
  query?: string | { query?: string };
}
interface Dashboard {
  title?: string;
  uid?: string;
  id?: number | null;
  schemaVersion?: number;
  panels?: Panel[];
  templating?: { list?: Variable[] };
}

const allPanels = (panels: Panel[] = []): Panel[] =>
  panels.flatMap((panel) => [panel, ...allPanels(panel.panels)]);

/** The queries of the dashboard: every panel target, and every variable that queries Prometheus. */
function dashboardQueries(dashboard: Dashboard): string[] {
  const fromPanels = allPanels(dashboard.panels).flatMap((panel) =>
    (panel.targets ?? []).map((target) => target.expr ?? ''),
  );
  const fromVariables = (dashboard.templating?.list ?? [])
    .filter((variable) => variable.type === 'query')
    .map((variable) =>
      typeof variable.query === 'string' ? variable.query : (variable.query?.query ?? ''),
    );
  return [...fromPanels, ...fromVariables];
}

/** The label names an expression groups by, selects on, or (in `label_values`) asks for. */
function labelsUsed(expr: string): string[] {
  const grouping = [...expr.matchAll(/\b(?:by|without)\s*\(([^)]*)\)/g)].flatMap((m) =>
    m[1]!
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean),
  );
  const selectors = [...expr.matchAll(/\{([^}]*)\}/g)].flatMap((m) =>
    [...m[1]!.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:=~|!~|!=|=)/g)].map((label) => label[1]!),
  );
  const asked = [...expr.matchAll(/label_values\([^,]+,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)].map(
    (m) => m[1]!,
  );
  return [...new Set([...grouping, ...selectors, ...asked])];
}

/**
 * The labels of an expression that none of the metrics it names has. `le` belongs to a histogram's
 * buckets, and `job` and `instance` are added by Prometheus to every series it scrapes.
 */
function unknownLabels(expr: string, metrics: Registry): string[] {
  const known = new Set(['le', 'job', 'instance']);
  for (const name of metricNames(expr)) {
    const suffix = /_(?:bucket|sum|count)$/.exec(name);
    const metric =
      metrics.getSingleMetric(name) ??
      (suffix ? metrics.getSingleMetric(name.slice(0, -suffix[0].length)) : undefined);
    const labelNames = (metric as unknown as { labelNames?: string[] } | undefined)?.labelNames;
    for (const label of labelNames ?? []) known.add(label);
  }
  return labelsUsed(expr).filter((label) => !known.has(label));
}

/**
 * The default process metrics the dashboard may use. `collectDefaultMetrics` registers different
 * ones on macOS and on Linux (for example `process_open_fds` is Linux only), and this spec reads the
 * registry of the machine it runs on: a name outside this list could pass in CI and fail on a laptop.
 */
const PORTABLE_DEFAULT_METRICS = [
  'process_cpu_seconds_total',
  'process_resident_memory_bytes',
  'process_start_time_seconds',
  'nodejs_eventloop_lag_p99_seconds',
  'nodejs_heap_size_used_bytes',
];

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

describe('Grafana dashboard', () => {
  const text = (): string => readFileSync(DASHBOARD_PATH, 'utf8');
  const dashboard = (): Dashboard => JSON.parse(text()) as Dashboard;

  it('is a dashboard with an identity of its own and nothing that names a host', () => {
    const { title, uid, id, schemaVersion } = dashboard();

    expect(typeof title).toBe('string');
    expect(typeof uid).toBe('string');
    expect(id).toBeNull();
    expect(typeof schemaVersion).toBe('number');
    // `__inputs` is resolved by the import dialog only, and may carry a host.
    expect(text()).not.toContain('__inputs');
  });

  it('queries only metrics the service exports', () => {
    const queries = dashboardQueries(dashboard());
    // Guards the lookup itself: a walker that finds no query would make the check below vacuous.
    expect(queries.length).toBeGreaterThan(0);

    expect(unknownMetrics(metricNames(queries.join('\n')), registry)).toEqual([]);
  });

  it('uses only default metrics that every platform registers', () => {
    const used = metricNames(dashboardQueries(dashboard()).join('\n')).filter((name) =>
      /^(?:process|nodejs)_/.test(name),
    );

    expect(used.filter((name) => !PORTABLE_DEFAULT_METRICS.includes(name))).toEqual([]);
  });

  it('would notice a label that its metric does not have', () => {
    const grouped = (label: string) =>
      `sum by (${label}) (rate(telemetry_messages_total{job=~"$job"}[$__rate_interval]))`;

    expect(unknownLabels(grouped('result'), registry)).toEqual([]);
    expect(unknownLabels(grouped('resulte'), registry)).toEqual(['resulte']);
    // A real label, but of another metric.
    expect(unknownLabels(grouped('reason'), registry)).toEqual(['reason']);
    expect(
      unknownLabels('label_values(process_start_time_seconds{job=~"$job"}, instance)', registry),
    ).toEqual([]);
  });

  it('groups and selects only on labels of the metrics it queries', () => {
    const queries = dashboardQueries(dashboard());
    expect(queries.length).toBeGreaterThan(0);

    const unknown = queries.flatMap((query) =>
      unknownLabels(query, registry).map((label) => `${label}: ${query}`),
    );
    expect(unknown).toEqual([]);
  });

  it('gives every panel an id of its own, a query, and the datasource variable', () => {
    const panels = allPanels(dashboard().panels);
    // Guards the lookup itself: finding no panel would make the checks below vacuous.
    expect(panels.length).toBeGreaterThan(0);

    const ids = panels.map((panel) => panel.id);
    expect(ids.every((id) => typeof id === 'number')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    const charts = panels.filter((panel) => panel.type !== 'row');
    expect(charts.length).toBeGreaterThan(0);
    expect(
      charts.filter((panel) => !(panel.targets ?? []).some((target) => target.expr)).length,
    ).toBe(0);
    expect(charts.filter((panel) => panel.datasource?.uid !== '${DS_PROMETHEUS}').length).toBe(0);

    // No datasource uid copied from a Grafana, and none written as a plain string.
    const uids = [...text().matchAll(/"datasource"\s*:\s*\{[^}]*?"uid"\s*:\s*"([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(uids.length).toBeGreaterThan(0);
    expect(uids.filter((uid) => uid !== '${DS_PROMETHEUS}')).toEqual([]);
    expect(text()).not.toMatch(/"datasource"\s*:\s*"/);
  });

  it('has the datasource, job and instance variables, the last two read from a metric that is always there', () => {
    const variables = dashboard().templating?.list ?? [];
    const byName = (name: string) => variables.find((variable) => variable.name === name);

    expect(byName('DS_PROMETHEUS')?.type).toBe('datasource');
    for (const name of ['job', 'instance']) {
      const query = byName(name)?.query;
      expect(byName(name)?.type).toBe('query');
      expect(typeof query === 'string' ? query : query?.query).toContain(
        'process_start_time_seconds',
      );
    }
  });
});

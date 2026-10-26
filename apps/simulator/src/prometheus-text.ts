/** One sample of the Prometheus text exposition: `name{label="value"} 12.5`. */
export interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/**
 * The ingest metrics Studio forwards, copied from `apps/ingest/src/metrics/metrics.ts` (the contract
 * package does not export Prometheus names). Renaming one there means changing it here too. The flush
 * time, the buffered readings and the lag buckets are for the Analytics page: the benchmark's series and
 * the session charts (`bench-series.ts` turns the buckets into a quantile of a window).
 */
export const FORWARDED_METRICS: readonly string[] = [
  'telemetry_messages_total',
  'telemetry_rejections_total',
  'telemetry_readings_total',
  'telemetry_sequence_gaps_total',
  'telemetry_ingest_lag_seconds_sum',
  'telemetry_ingest_lag_seconds_count',
  'telemetry_ingest_lag_seconds_bucket',
  'telemetry_flush_duration_seconds_bucket',
  'telemetry_flush_duration_seconds_sum',
  'telemetry_flush_duration_seconds_count',
  'telemetry_buffered_readings',
  'alerts_transitions_total',
  'alert_deliveries_total',
];

const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*/;

function parseValue(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  if (text === 'NaN') return NaN;
  if (text === '+Inf' || text === 'Inf') return Infinity;
  if (text === '-Inf') return -Infinity;
  const value = Number(text);
  return text !== '' && !Number.isNaN(value) ? value : undefined;
}

/** Reads `{a="1",b="2"}` starting at the brace; returns the labels and the index after the `}`. */
function parseLabels(line: string, start: number): [Record<string, string>, number] | undefined {
  const labels: Record<string, string> = {};
  let i = start + 1;
  for (;;) {
    while (line[i] === ' ') i++;
    if (line[i] === '}') return [labels, i + 1];
    const name = LABEL_NAME.exec(line.slice(i))?.[0];
    if (!name || line.slice(i + name.length, i + name.length + 2) !== '="') return undefined;
    i += name.length + 2;
    let value = '';
    for (;;) {
      const char = line[i];
      if (char === undefined) return undefined;
      i++;
      if (char === '"') break;
      if (char === '\\') {
        const next = line[i++];
        if (next === undefined) return undefined;
        value += next === 'n' ? '\n' : next;
      } else {
        value += char;
      }
    }
    labels[name] = value;
    while (line[i] === ' ') i++;
    if (line[i] === ',') i++;
    else if (line[i] !== '}') return undefined;
  }
}

function parseLine(line: string): Sample | undefined {
  const name = METRIC_NAME.exec(line)?.[0];
  if (!name) return undefined;
  let labels: Record<string, string> = {};
  let rest = name.length;
  if (line[rest] === '{') {
    const parsed = parseLabels(line, rest);
    if (!parsed) return undefined;
    [labels, rest] = parsed;
  }
  // After the labels: the value, then an optional timestamp that is not needed.
  const value = parseValue(line.slice(rest).trim().split(/\s+/)[0]);
  return value === undefined ? undefined : { name, labels, value };
}

/**
 * Parses the Prometheus text format (version 0.0.4, what `prom-client` writes). Comments, `# HELP`
 * and `# TYPE` lines are skipped, and so is a line that does not parse: a scrape is read on a
 * best-effort basis, one odd line must not hide the rest.
 */
export function parseExposition(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const sample = parseLine(line);
    if (sample) samples.push(sample);
  }
  return samples;
}

/**
 * Keeps the forwarded metrics, and only samples with a finite value: the stream is JSON, where
 * `NaN` and infinity cannot be written.
 */
export function selectForwarded(samples: Sample[]): Sample[] {
  return samples.filter((s) => FORWARDED_METRICS.includes(s.name) && Number.isFinite(s.value));
}

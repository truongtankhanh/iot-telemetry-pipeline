import type { BenchmarkOutcome, BenchmarkRunDetail, BenchmarkRunSummary } from '../api/types';

/**
 * What the results list and the download say about a finished run. The numbers are the simulator's: `result` is the command line's
 * own `--json` object (same fields, formulas and rounding), shown and exported exactly as it came; nothing here recomputes a rate.
 */

export type OutcomeTone = 'ok' | 'warn' | 'bad';

/** The outcome in a word, with a tone for its icon: the word is the signal, not the colour. */
export const OUTCOMES: Record<BenchmarkOutcome, { word: string; tone: OutcomeTone }> = {
  completed: { word: 'Completed', tone: 'ok' },
  incomplete: { word: 'Incomplete (timed out)', tone: 'warn' },
  stopped: { word: 'Stopped', tone: 'warn' },
  failed: { word: 'Failed', tone: 'bad' },
};

/** `100000` as "100,000". The page is in English whatever the browser's locale: the numbers are compared with the documents. */
export const formatCount = (value: number): string => Math.round(value).toLocaleString('en-US');

/** Seconds as "17.6 s", or "1 min 05 s" from a minute on. */
export function formatSeconds(seconds: number): string {
  if (!(seconds >= 0)) return '0 s';
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds * 10) / 10} s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, '0')} s`;
}

export interface ResultRow {
  id: number;
  title: string;
  outcome: { word: string; tone: OutcomeTone };
  /** True only for a run that completed; anything else is not a result to compare. */
  comparable: boolean;
  comparableWord: string;
  size: string;
  /** "5,669 messages/s · 11,338 readings/s end to end", or `null` when the run has no result. */
  rates: string | null;
  /** How long the run took, in words. */
  duration: string;
  /** Why it did not complete, in the simulator's words, or `null`. */
  reason: string | null;
  startedAt: string;
}

/** A finished run as a line of the results list. */
export function resultRow(run: BenchmarkRunSummary): ResultRow {
  const outcome = OUTCOMES[run.outcome ?? 'failed'];
  const comparable = run.comparable === true;
  return {
    id: run.id,
    title: `Run ${run.id}`,
    outcome,
    comparable,
    comparableWord: comparable ? 'comparable' : 'not comparable',
    size: `${formatCount(run.settings.messages)} messages`,
    rates:
      run.result === null
        ? null
        : `${formatCount(run.result.messagesPerSecond)} messages/s · ${formatCount(run.result.readingsPerSecond)} readings/s end to end`,
    duration: formatSeconds(run.elapsedMs / 1000),
    reason: run.reason,
    startedAt: run.startedAt,
  };
}

/** The version of the download's shape: a reader of the file can tell when it changes. */
export const DOWNLOAD_FORMAT = 'studio-benchmark-run';
export const DOWNLOAD_VERSION = 1;

/**
 * The file a person keeps of a run: the run as the simulator described it (settings, outcome, reason, marks), its `result` exactly
 * as the command line prints it, and the series. `database` is `host:port/name` as the simulator reports it; the document has no
 * credentials because nothing it is made of has any.
 */
export function downloadDocument(run: BenchmarkRunDetail, database: string | null): string {
  const { series, result, ...summary } = run;
  return `${JSON.stringify(
    { format: DOWNLOAD_FORMAT, version: DOWNLOAD_VERSION, database, run: summary, result, series },
    null,
    2,
  )}\n`;
}

/** `studio-benchmark-3-20261027-0930.json`: the run's number and the UTC time it started. */
export function downloadName(run: Pick<BenchmarkRunSummary, 'id' | 'startedAt'>): string {
  const started = new Date(run.startedAt);
  const stamp = Number.isNaN(started.getTime())
    ? 'unknown-time'
    : started.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return `studio-benchmark-${run.id}-${stamp}.json`;
}

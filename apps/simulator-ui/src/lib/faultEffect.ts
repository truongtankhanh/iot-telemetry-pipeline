import type { FaultEffectView, FaultsSnapshot, MetricsFeed } from '../api/types';
import { total } from './ingestRates';

/**
 * The effect panel of the Faults page (frame 07): the change, since the faults were switched on, of the four counters of
 * ingest that show what the pipeline did about them. The simulator keeps the moment and the counters then (`faultEffect` of the
 * state view, "the baseline"); the counters now are the `metrics` slice, so the change is `now − baseline`, worked out here.
 *
 * Nothing is guessed. No baseline (ingest could not be read when the faults went on) gives no figures, and a counter that
 * went down (ingest restarted, its counters began again at 0) gives none for that row. A series ingest has not exported
 * yet is 0, because a labelled Prometheus counter appears only after its first increment.
 *
 * The names of the series are a copy of `apps/ingest/src/metrics/metrics.ts` (the same copy `lib/ingestRates.ts` and the
 * simulator's `FORWARDED_METRICS` carry); renaming one there means changing it here too.
 */

export type EffectStatus = 'none' | 'no-baseline' | 'ready';

export interface EffectRow {
  /** Stable key of the row. */
  id: string;
  /** The series, as it is in `/metrics`. */
  metric: string;
  /** What can move it now, in words. */
  detail: string;
  /** The change since the baseline; `null` when it cannot be told. */
  delta: number | null;
  /** The counter is lower than the baseline: ingest started again. */
  restarted: boolean;
}

export interface FaultEffectModel {
  status: EffectStatus;
  /** When the faults were switched on (ISO 8601), or `null` before any was. */
  since: string | null;
  rows: EffectRow[];
  /** Sentences under the rows: what to keep in mind reading them. */
  notes: string[];
}

export interface FaultEffectInput {
  faults: FaultsSnapshot;
  effect: FaultEffectView | null;
  metrics: MetricsFeed;
}

const GAPS = 'telemetry_sequence_gaps_total';
const REJECTIONS = 'telemetry_rejections_total';
const MESSAGES = 'telemetry_messages_total';
const READINGS = 'telemetry_readings_total';

/** `a, b and c`. */
function list(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function gapsDetail(faults: FaultsSnapshot): string {
  const causes = [
    faults.drop ? 'Drop' : null,
    faults.malformed ? 'Malformed' : null,
    faults.linkLoss ? 'Link loss' : null,
  ].filter((cause): cause is string => cause !== null);
  return causes.length === 0
    ? 'messages ingest confirmed missing'
    : `from ${list(causes)}, confirmed after ingest’s grace period`;
}

/** The change of one series, or why there is none. */
function change(
  input: FaultEffectInput,
  name: string,
  labels: Record<string, string> = {},
): { delta: number | null; restarted: boolean } {
  const { effect, metrics } = input;
  if (effect === null || effect.baseline === null) return { delta: null, restarted: false };
  if (metrics.lastOkAt === null) return { delta: null, restarted: false };
  const now = total(metrics.samples, name, labels) ?? 0;
  const before = total(effect.baseline, name, labels) ?? 0;
  if (now < before) return { delta: null, restarted: true };
  return { delta: now - before, restarted: false };
}

const malformedKinds = (faults: FaultsSnapshot): readonly string[] => faults.malformed?.kinds ?? [];

/** The reasons of rejection to show: those on in the malformed fault, and any with a change above 0, biggest first. */
function reasons(input: FaultEffectInput): { reason: string; delta: number | null }[] {
  const { faults, effect, metrics } = input;
  const mine = malformedKinds(faults);
  const seen = new Set<string>(mine);
  for (const sample of [...metrics.samples, ...(effect?.baseline ?? [])]) {
    if (sample.name === REJECTIONS && sample.labels.reason !== undefined) {
      seen.add(sample.labels.reason);
    }
  }
  return [...seen]
    .map((reason) => ({ reason, delta: change(input, REJECTIONS, { reason }).delta }))
    .filter(({ reason, delta }) => mine.includes(reason) || (delta ?? 0) > 0)
    .sort((a, b) => (b.delta ?? -1) - (a.delta ?? -1) || a.reason.localeCompare(b.reason));
}

export function faultEffect(input: FaultEffectInput): FaultEffectModel {
  const { faults, effect, metrics } = input;
  if (effect === null) return { status: 'none', since: null, rows: [], notes: [] };

  const noBaseline = effect.baseline === null;
  const rows: EffectRow[] = [];

  const gaps = change(input, GAPS);
  rows.push({ id: 'gaps', metric: GAPS, detail: gapsDetail(faults), ...gaps });

  const rejected = reasons(input);
  if (rejected.length === 0) {
    rows.push({
      id: 'rejections',
      metric: REJECTIONS,
      detail: 'rejected before storage, any reason',
      ...change(input, REJECTIONS),
    });
  }
  for (const { reason } of rejected) {
    const mine = malformedKinds(faults).includes(reason);
    rows.push({
      id: `rejections:${reason}`,
      metric: `${REJECTIONS}{reason="${reason}"}`,
      detail: mine ? 'from Malformed payloads' : 'rejected by ingest',
      ...change(input, REJECTIONS, { reason }),
    });
  }

  rows.push({
    id: 'messages',
    metric: MESSAGES,
    detail: faults.duplicate ? 'including duplicates' : 'accepted and rejected',
    ...change(input, MESSAGES),
  });
  rows.push({
    id: 'readings',
    metric: `${READINGS}{result="stored"}`,
    detail: 'stored once each, counted per metric',
    ...change(input, READINGS, { result: 'stored' }),
  });

  const notes: string[] = [];
  if (noBaseline) {
    notes.push(
      'Ingest could not be read when the faults were switched on, so there is nothing to subtract. Reset counters starts from now.',
    );
  } else if (metrics.lastOkAt === null || metrics.stale) {
    notes.push('Ingest is not being read now; the figures are from the last read, or missing.');
  }
  if (rows.some((row) => row.restarted)) {
    notes.push(
      'A counter is lower than it was: ingest started again. Reset counters starts from now.',
    );
  }
  if (faults.drop || faults.malformed || faults.linkLoss) {
    notes.push(
      'A message that never arrived becomes a gap only after ingest’s grace period (30 s by default), so the gap row trails its cause.',
    );
  }

  return { status: noBaseline ? 'no-baseline' : 'ready', since: effect.since, rows, notes };
}

/** "+25", "+0"; "—" for a figure that cannot be told. */
export function deltaText(row: Pick<EffectRow, 'delta'>): string {
  return row.delta === null ? '—' : `+${row.delta.toLocaleString('en-US')}`;
}

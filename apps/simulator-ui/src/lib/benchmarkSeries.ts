import type {
  BenchmarkPhase,
  BenchmarkPoint,
  BenchmarkRunDetail,
  BenchmarkRunSummary,
} from '../api/types';

/**
 * What the Analytics page works out of a benchmark run's series, kept out of the components and out of the store: merging what
 * arrives (the stream's events and the read of `GET /api/benchmark` overlap), the unit of the throughput chart, the in-flight gap,
 * the average of the steady state and the projected finish. Pure functions of what the simulator sent.
 *
 * The numbers the simulator itself works out (`result`: `messagesPerSecond`, `readingsPerSecond`, `endToEndSeconds`) are never
 * recomputed here (they are the command line's, in its rounding). Only what a chart needs between two points is derived.
 */

/** The most points the simulator keeps for a run: when it is full, the newest replaces the last (`benchmark-run.ts`). */
export const MAX_POINTS = 1000;

const PHASE_RANK: Record<BenchmarkPhase, number> = {
  starting: 0,
  publishing: 1,
  waiting: 2,
  ended: 3,
};

/**
 * Whether `next` says more about a run than `known` does. The read of `GET /api/benchmark` can come back after a live event that
 * is newer than it is, and must not turn a run that ended back into one that publishes: a later phase wins, then more time
 * elapsed, then more messages published.
 */
export function isNewerSummary(next: BenchmarkRunSummary, known: BenchmarkRunSummary): boolean {
  const byPhase = PHASE_RANK[next.phase] - PHASE_RANK[known.phase];
  if (byPhase !== 0) return byPhase > 0;
  if (next.elapsedMs !== known.elapsedMs) return next.elapsedMs > known.elapsedMs;
  return next.published > known.published;
}

const samePoint = (a: BenchmarkPoint, b: BenchmarkPoint): boolean =>
  a.t === b.t &&
  a.published === b.published &&
  a.stored === b.stored &&
  a.buffered === b.buffered &&
  a.flushP95S === b.flushP95S &&
  a.queueDelayS === b.queueDelayS;

/**
 * `known` and `incoming` as one series: ascending by `t`, each `t` once (the incoming point wins, it is the later reading), and
 * no longer than the simulator keeps it. When nothing changes, `known` itself is returned, so the caller can tell by identity
 * and a store does not announce a change that is not one.
 */
export function mergePoints(
  known: readonly BenchmarkPoint[],
  incoming: readonly BenchmarkPoint[],
): readonly BenchmarkPoint[] {
  if (incoming.length === 0) return known;

  // The usual case, one point after the last: no sorting, no map.
  const last = known.at(-1);
  const only = incoming[0];
  if (incoming.length === 1 && only !== undefined && (last === undefined || only.t > last.t)) {
    return capped([...known, only]);
  }

  const byTime = new Map<number, BenchmarkPoint>(known.map((point) => [point.t, point]));
  let changed = false;
  for (const point of incoming) {
    const before = byTime.get(point.t);
    if (before !== undefined && samePoint(before, point)) continue;
    byTime.set(point.t, point);
    changed = true;
  }
  if (!changed) return known;
  return capped([...byTime.values()].sort((a, b) => a.t - b.t));
}

/** The simulator's rule for a full series: the first points stay and the newest takes the last place. */
function capped(series: BenchmarkPoint[]): BenchmarkPoint[] {
  if (series.length <= MAX_POINTS) return series;
  const newest = series[series.length - 1] as BenchmarkPoint;
  return [...series.slice(0, MAX_POINTS - 1), newest];
}

/**
 * A run after `summary` and `points` arrived. `summary` replaces the known one only when it is newer; the points are merged.
 * `known` itself comes back when nothing changed (same identity), and `summary` may carry its own `series` (a read does): it is
 * merged, not trusted.
 */
export function mergeRun(
  known: BenchmarkRunDetail | undefined,
  summary: BenchmarkRunSummary,
  points: readonly BenchmarkPoint[],
): BenchmarkRunDetail {
  const incoming =
    'series' in summary ? [...(summary as BenchmarkRunDetail).series, ...points] : points;
  const series = mergePoints(known?.series ?? [], incoming);
  if (known === undefined) return { ...summary, series: [...series] };
  const wins = isNewerSummary(summary, known);
  if (!wins && series === known.series) return known;
  return { ...(wins ? summary : known), series: [...series] };
}

/**
 * How many readings one message of this run carries: the registry's mix of metrics, so 2.00001 for 100,000 messages of the demo's
 * six devices (200,001 readings). Exact for the run, since `expectedReadings` is a closed form of the same loop.
 */
export function readingsPerMessage(
  run: Pick<BenchmarkRunSummary, 'expectedReadings' | 'settings'>,
): number {
  return run.settings.messages > 0 ? run.expectedReadings / run.settings.messages : 1;
}

/**
 * Messages acknowledged, in readings: the unit the database counts in. The chart draws published and stored in this one
 * unit, so the two lines meet at the end of the run and the gap between them is what is in flight (decision Q1).
 */
export function publishedAsReadings(
  published: number,
  run: Pick<BenchmarkRunSummary, 'expectedReadings' | 'settings'>,
): number {
  return published * readingsPerMessage(run);
}

/**
 * Readings published and not yet stored: in the broker, in ingest's buffer or in its flush. `null` while the stored count is
 * unknown. Never negative: a count read a moment apart from the publish count is not evidence of readings stored before they
 * were published.
 */
export function inFlightReadings(
  point: Pick<BenchmarkPoint, 'published' | 'stored'>,
  run: Pick<BenchmarkRunSummary, 'expectedReadings' | 'settings'>,
): number | null {
  if (point.stored === null) return null;
  return Math.max(0, Math.round(publishedAsReadings(point.published, run)) - point.stored);
}

/** What happened between two points of a series, per second. `null` is unknown, never zero. */
export interface RateSample {
  /** The start of the interval, in seconds since the run began; `t` is its end. */
  from: number;
  t: number;
  /** Messages acknowledged per second. */
  messagesPerS: number;
  /** The same, in readings (the chart's unit). */
  publishedPerS: number;
  /** Readings stored per second, or `null` while either count is unknown. */
  storedPerS: number | null;
}

/**
 * The rates between consecutive points. An interval of no time or of a count that went backwards (a run that began again)
 * gives no sample. Rates are the difference of two cumulative counts: an observation of the last second, not an average.
 */
export function throughputOf(
  series: readonly BenchmarkPoint[],
  run: Pick<BenchmarkRunSummary, 'expectedReadings' | 'settings'>,
): RateSample[] {
  const ratio = readingsPerMessage(run);
  const samples: RateSample[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const before = series[i - 1] as BenchmarkPoint;
    const after = series[i] as BenchmarkPoint;
    const seconds = after.t - before.t;
    const published = after.published - before.published;
    if (!(seconds > 0) || published < 0) continue;
    const stored =
      after.stored !== null && before.stored !== null && after.stored >= before.stored
        ? (after.stored - before.stored) / seconds
        : null;
    samples.push({
      from: before.t,
      t: after.t,
      messagesPerS: published / seconds,
      publishedPerS: (published * ratio) / seconds,
      storedPerS: stored,
    });
  }
  return samples;
}

/**
 * The average publish rate (readings per second) of the steady state: the intervals that begin after the ramp-up and end by the
 * time publishing ended. `null` while the ramp-up has not ended (there is no steady state yet) or nothing falls inside it.
 */
export function steadyAverage(
  samples: readonly RateSample[],
  marks: { rampUpEndS: number | null; publishEndedS: number | null },
): number | null {
  const { rampUpEndS, publishEndedS } = marks;
  if (rampUpEndS === null) return null;
  const inside = samples.filter(
    (sample) => sample.from >= rampUpEndS && (publishEndedS === null || sample.t <= publishEndedS),
  );
  if (inside.length === 0) return null;
  return inside.reduce((sum, sample) => sum + sample.publishedPerS, 0) / inside.length;
}

/** How many of the latest stored rates the projected finish averages: one second is noisy, a long average is late. */
const FINISH_WINDOW = 3;

/**
 * Seconds until every reading is stored, at the rate it is being stored now (the mean of the last few stored rates). An
 * estimate, and drawn as one: `null` when the run has ended, the stored count is unknown or nothing is being stored.
 */
export function remainingSeconds(
  run: Pick<BenchmarkRunSummary, 'expectedReadings' | 'stored' | 'phase'>,
  samples: readonly RateSample[],
): number | null {
  if (run.phase === 'ended' || run.stored === null) return null;
  const rates = samples
    .map((sample) => sample.storedPerS)
    .filter((rate): rate is number => rate !== null)
    .slice(-FINISH_WINDOW);
  if (rates.length === 0) return null;
  const rate = rates.reduce((sum, value) => sum + value, 0) / rates.length;
  if (!(rate > 0)) return null;
  return Math.max(0, (run.expectedReadings - run.stored) / rate);
}

/** The figures of a run for its tiles and its captions. `null` is unknown, never zero. */
export interface RunFigures {
  /** Messages published per second: the last second of a run going, the command line's `messagesPerSecond` for one that completed. */
  messagesPerS: { value: number | null; basis: 'now' | 'end to end' };
  /** Readings stored per second, on the same basis. */
  storedPerS: { value: number | null; basis: 'now' | 'end to end' };
  /** The estimated queue delay of the last point, in seconds. */
  queueDelayS: number | null;
  /** The flush time's 95th percentile at the last point, in seconds. */
  flushP95S: number | null;
  /** Readings published and not yet stored, from the run's own counts. */
  inFlight: number | null;
  /** The projected finish, in seconds; see `remainingSeconds`. */
  remainingS: number | null;
}

/**
 * What the tiles of a run say. A run that has a `result` shows the result's own rates (the command line's numbers, in its rounding,
 * as the acceptance criterion wants); a run still going shows what the last second did, worked out from the series. The queue delay
 * and the flush time are those of the last point either way.
 */
export function runFigures(run: BenchmarkRunDetail): RunFigures {
  const samples = throughputOf(run.series, run);
  const lastRate = samples.at(-1);
  const lastPoint = run.series.at(-1);
  const result = run.result;
  return {
    messagesPerS:
      result === null
        ? { value: lastRate?.messagesPerS ?? null, basis: 'now' }
        : { value: result.messagesPerSecond, basis: 'end to end' },
    storedPerS:
      result === null
        ? { value: lastRate?.storedPerS ?? null, basis: 'now' }
        : { value: result.readingsPerSecond, basis: 'end to end' },
    queueDelayS: lastPoint?.queueDelayS ?? null,
    flushP95S: lastPoint?.flushP95S ?? null,
    inFlight: inFlightReadings({ published: run.published, stored: run.stored }, run),
    remainingS: remainingSeconds(run, samples),
  };
}

import type { Sample } from './prometheus-text.ts';

/** One cumulative bucket of a Prometheus histogram: the observations at or below `le`. */
export interface Bucket {
  le: number;
  count: number;
}

/**
 * The buckets of one histogram, from its `<name>_bucket` samples, sorted by `le` (`+Inf` last). Series that
 * share an `le` (a histogram with other labels) are added together. A sample whose `le` is not a number is
 * skipped: one odd line must not hide the rest, as in `parseExposition`.
 */
export function readBuckets(samples: readonly Sample[], name: string): Bucket[] {
  const counts = new Map<number, number>();
  for (const sample of samples) {
    if (sample.name !== `${name}_bucket`) continue;
    const text = sample.labels.le;
    const le = text === '+Inf' ? Infinity : Number(text);
    if (text === undefined || text === '' || Number.isNaN(le)) continue;
    counts.set(le, (counts.get(le) ?? 0) + sample.value);
  }
  return [...counts].map(([le, count]) => ({ le, count })).sort((a, b) => a.le - b.le);
}

/**
 * The `q` quantile (0 to 1) of what a histogram observed **between two reads**: the bucket counts of
 * `current` minus those of `previous`. Ingest's histograms are cumulative since it booted, so a quantile of
 * the raw buckets would describe the whole life of the process, not the last second of a run.
 *
 * Interpolates linearly inside the bucket, as `histogram_quantile` does. An answer that falls in the `+Inf`
 * bucket is the last finite bound: nothing finer can be said. `null` means unknown, never zero: no earlier
 * read, nothing observed in the window, or a counter that went back (ingest restarted).
 */
export function windowQuantile(
  previous: readonly Bucket[] | undefined,
  current: readonly Bucket[],
  q: number,
): number | null {
  if (previous === undefined || current.length === 0) return null;
  const before = new Map(previous.map((bucket) => [bucket.le, bucket.count]));
  const window: Bucket[] = [];
  let lastCount = 0;
  for (const bucket of current) {
    const count = bucket.count - (before.get(bucket.le) ?? 0);
    if (count < 0) return null;
    // Cumulative counts cannot fall; a reading that does is read as the previous one rather than guessed at.
    lastCount = Math.max(lastCount, count);
    window.push({ le: bucket.le, count: lastCount });
  }
  const total = window[window.length - 1]!.count;
  if (total <= 0) return null;

  const rank = q * total;
  let lowerBound = 0;
  let lowerCount = 0;
  for (const bucket of window) {
    if (bucket.count >= rank) {
      if (!Number.isFinite(bucket.le)) return lowerBound;
      const inBucket = bucket.count - lowerCount;
      if (inBucket <= 0) return bucket.le;
      return lowerBound + ((bucket.le - lowerBound) * (rank - lowerCount)) / inBucket;
    }
    lowerBound = bucket.le;
    lowerCount = bucket.count;
  }
  return lowerBound;
}

/**
 * How long a reading waits between being published and being stored, estimated: the readings still in
 * flight divided by the rate they are being stored at (Little's law). Ingest's own lag histogram cannot say
 * it on a benchmark run, whose readings are stamped an hour in the past. `0` with nothing in flight, `null`
 * when something is in flight and nothing is being stored (unknown, not infinite).
 */
export function queueDelayS(inFlightReadings: number, storedReadingsPerS: number): number | null {
  if (inFlightReadings <= 0) return 0;
  if (!(storedReadingsPerS > 0)) return null;
  return inFlightReadings / storedReadingsPerS;
}

/** What the run sampled about publishing: seconds since it started and messages published by then. */
export interface RatePoint {
  t: number;
  published: number;
}

/** The published rate must reach this share of the run's median rate for the ramp-up to be over. */
const RAMP_UP_SHARE = 0.9;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Where the ramp-up of a finished run ends: the `t` at which the published rate first reaches 90 % of the
 * run's median published rate. Only the intervals that started before the last message was published count,
 * so the wait for storage (a rate of zero) does not drag the median down. `null` for a run too short to have
 * one: fewer than three points, or no message published in the intervals that count.
 */
export function rampUpEndS(points: readonly RatePoint[], messages: number): number | null {
  if (points.length < 3) return null;
  const intervals: { from: number; rate: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const [from, to] = [points[i - 1]!, points[i]!];
    if (from.published >= messages || to.t <= from.t) continue;
    intervals.push({ from: from.t, rate: (to.published - from.published) / (to.t - from.t) });
  }
  if (intervals.length === 0) return null;
  const level = median(intervals.map((interval) => interval.rate)) * RAMP_UP_SHARE;
  if (!(level > 0)) return null;
  return intervals.find((interval) => interval.rate >= level)?.from ?? null;
}

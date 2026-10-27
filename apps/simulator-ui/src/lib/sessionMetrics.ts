import type { MetricSample, MetricsFeed } from '../api/types';
import { ingestRates, total } from './ingestRates';

/**
 * The session charts of the Analytics page (message rate, stored rate, ingest lag, flush time, buffered readings): one point
 * out of two reads of ingest's `/metrics`, as the simulator forwards them once a second. Pure functions; the store that keeps the
 * points is `state/sessionMetricsStore.ts`.
 *
 * `histogramQuantile` below is a copy of `windowQuantile` in `apps/simulator/src/bench-series.ts`, which works the same figure
 * out for a benchmark run's series: this package cannot import from the simulator, and the contract package is read by
 * platform-aws, which is not a place to move a chart's arithmetic to. Change the two together; the tests of both pin the
 * interpolation.
 */

export const MESSAGES = 'telemetry_messages_total';
export const FLUSH = 'telemetry_flush_duration_seconds';
export const BUFFERED = 'telemetry_buffered_readings';

/** One second of ingest, as the session charts draw it. `null` is unknown, never zero. */
export interface SessionPoint {
  /** When the simulator read ingest (ms since the epoch). */
  at: number;
  /** MQTT messages ingest received per second, whatever their result (`telemetry_messages_total`). */
  messagesPerS: number | null;
  /** Readings written per second (`telemetry_readings_total{result="stored"}`). */
  storedPerS: number | null;
  /** The mean time from measurement to storage over the readings written between the two reads, in seconds. */
  lagMeanS: number | null;
  /** The 95th percentile of the flush time over the two reads, in seconds. */
  flushP95S: number | null;
  /** Readings waiting for the next flush. */
  buffered: number | null;
}

/** One cumulative bucket of a Prometheus histogram: the observations at or below `le`. */
export interface Bucket {
  le: number;
  count: number;
}

/**
 * The buckets of one histogram, from its `<name>_bucket` samples, sorted by `le` (`+Inf` last). Series that share an `le` are
 * added together; a sample whose `le` is not a number is skipped, so that one odd line does not hide the rest.
 */
export function readBuckets(samples: readonly MetricSample[], name: string): Bucket[] {
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
 * The `q` quantile (0 to 1) of what a histogram observed **between two reads**: the bucket counts of `current` minus those of
 * `previous`. Ingest's histograms are cumulative since it started, so the quantile of the raw buckets would describe the
 * whole life of the process and not the last second. Interpolated inside the bucket as `histogram_quantile` does; an answer in
 * the `+Inf` bucket is the last finite bound, nothing finer can be said. `null` for no earlier read, nothing observed in the
 * window, or a counter that went back (ingest restarted).
 */
export function histogramQuantile(
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
    // Cumulative counts cannot fall; a reading that does is taken as the previous one rather than guessed at.
    lastCount = Math.max(lastCount, count);
    window.push({ le: bucket.le, count: lastCount });
  }
  const observed = window[window.length - 1]?.count ?? 0;
  if (observed <= 0) return null;

  const rank = q * observed;
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

/** Whether a feed can be read at all: ingest answered and the simulator knows when. */
const fresh = (feed: MetricsFeed | null): feed is MetricsFeed =>
  feed !== null && !feed.stale && feed.lastOkAt !== null;

/**
 * The point `next` makes against the read before it, or `null` when `next` is not a read of ingest (stale, or no time). Without
 * an earlier read, or when the two are not in order, the rates are unknown and the gauge is still the gauge. A rate is the
 * difference of two cumulative counters, so a counter that went back (ingest restarted) gives `null` and not a negative number.
 */
export function pointOf(previous: MetricsFeed | null, next: MetricsFeed): SessionPoint | null {
  if (!fresh(next)) return null;
  const at = Date.parse(next.lastOkAt as string);
  if (!Number.isFinite(at)) return null;

  const buffered = total(next.samples, BUFFERED);
  const earlier = fresh(previous) ? previous : null;
  const seconds = earlier === null ? 0 : (at - Date.parse(earlier.lastOkAt as string)) / 1000;
  if (earlier === null || !(seconds > 0)) {
    return {
      at,
      messagesPerS: null,
      storedPerS: null,
      lagMeanS: null,
      flushP95S: null,
      buffered,
    };
  }

  const before = total(earlier.samples, MESSAGES);
  const after = total(next.samples, MESSAGES);
  const delta = before === null || after === null ? null : after - before;
  const rates = ingestRates(earlier, next);
  return {
    at,
    messagesPerS: delta === null || delta < 0 ? null : delta / seconds,
    storedPerS: rates.storedPerSecond,
    lagMeanS: rates.lagSeconds,
    flushP95S: histogramQuantile(
      readBuckets(earlier.samples, FLUSH),
      readBuckets(next.samples, FLUSH),
      0.95,
    ),
    buffered,
  };
}

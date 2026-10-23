import type { MetricSample, MetricsFeed } from '../api/types';

/** What ingest did between two reads of its `/metrics`; `null` for a figure the two reads cannot give. */
export interface IngestRates {
  /** Readings written per second (`telemetry_readings_total{result="stored"}`). */
  storedPerSecond: number | null;
  /** Mean time from measurement to storage over the readings written between the reads, in seconds. */
  lagSeconds: number | null;
}

const NONE: IngestRates = { storedPerSecond: null, lagSeconds: null };

/** The total of one metric over the samples that match; `null` when ingest did not export it. */
export function total(
  samples: readonly MetricSample[],
  name: string,
  labels: Record<string, string> = {},
): number | null {
  const matching = samples.filter(
    (sample) =>
      sample.name === name && Object.entries(labels).every(([key, v]) => sample.labels[key] === v),
  );
  return matching.length === 0 ? null : matching.reduce((sum, sample) => sum + sample.value, 0);
}

/**
 * The readings ingest has stored since it started (`telemetry_readings_total{result="stored"}`), or `null` when the
 * feed is stale or ingest has not exported the counter. Something downstream advanced when this grows between two reads.
 */
export function storedReadings(feed: MetricsFeed): number | null {
  return feed.stale ? null : total(feed.samples, 'telemetry_readings_total', { result: 'stored' });
}

/**
 * Rates are the difference of two reads of cumulative counters, so they are an observation of the last second or so,
 * not an average since ingest started. Nothing is guessed: a feed that is stale, a first read, two reads at the same
 * moment, a counter that went backwards (ingest restarted) or a metric ingest has not exported yet gives `null` for
 * the figure it would have fed, and the node says nothing rather than a number.
 */
export function ingestRates(previous: MetricsFeed | null, next: MetricsFeed): IngestRates {
  if (previous === null || previous.stale || next.stale) return NONE;
  if (previous.lastOkAt === null || next.lastOkAt === null) return NONE;
  const seconds = (Date.parse(next.lastOkAt) - Date.parse(previous.lastOkAt)) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return NONE;

  const stored = { name: 'telemetry_readings_total', labels: { result: 'stored' } };
  const before = total(previous.samples, stored.name, stored.labels);
  const after = total(next.samples, stored.name, stored.labels);
  const storedDelta = before === null || after === null ? null : after - before;

  const sumBefore = total(previous.samples, 'telemetry_ingest_lag_seconds_sum');
  const sumAfter = total(next.samples, 'telemetry_ingest_lag_seconds_sum');
  const countBefore = total(previous.samples, 'telemetry_ingest_lag_seconds_count');
  const countAfter = total(next.samples, 'telemetry_ingest_lag_seconds_count');
  const lagDelta =
    sumBefore === null || sumAfter === null || countBefore === null || countAfter === null
      ? null
      : { sum: sumAfter - sumBefore, count: countAfter - countBefore };

  return {
    storedPerSecond: storedDelta === null || storedDelta < 0 ? null : storedDelta / seconds,
    lagSeconds:
      lagDelta === null || lagDelta.count <= 0 || lagDelta.sum < 0
        ? null
        : lagDelta.sum / lagDelta.count,
  };
}

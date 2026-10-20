import { describe, expect, it } from 'vitest';
import type { MetricSample, MetricsFeed } from '../api/types';
import { ingestRates, storedReadings } from './ingestRates';

const at = (second: number) => new Date(Date.UTC(2026, 9, 20, 9, 14, second)).toISOString();

function feed(
  second: number,
  { stored = 0, sum = 0, count = 0, extra = [] as MetricSample[] } = {},
  stale = false,
): MetricsFeed {
  return {
    lastOkAt: at(second),
    stale,
    samples: [
      { name: 'telemetry_readings_total', labels: { result: 'stored' }, value: stored },
      { name: 'telemetry_readings_total', labels: { result: 'duplicate' }, value: 99 },
      { name: 'telemetry_ingest_lag_seconds_sum', labels: {}, value: sum },
      { name: 'telemetry_ingest_lag_seconds_count', labels: {}, value: count },
      ...extra,
    ],
  };
}

describe('ingestRates', () => {
  it('turns the difference of two reads into readings per second and a mean lag', () => {
    const rates = ingestRates(
      feed(0, { stored: 100, sum: 2, count: 100 }),
      feed(2, { stored: 130, sum: 3.2, count: 130 }),
    );
    expect(rates.storedPerSecond).toBe(15);
    expect(rates.lagSeconds).toBeCloseTo(0.04, 5);
  });

  it('counts stored readings only, not duplicates', () => {
    const rates = ingestRates(feed(0, { stored: 10 }), feed(1, { stored: 12 }));
    expect(rates.storedPerSecond).toBe(2);
  });

  it('adds the samples of a metric that has several', () => {
    const split = (value: number): MetricSample[] => [
      { name: 'telemetry_readings_total', labels: { result: 'stored', node: 'a' }, value },
      { name: 'telemetry_readings_total', labels: { result: 'stored', node: 'b' }, value },
    ];
    const previous = feed(0, { extra: split(1) });
    const next = feed(1, { extra: split(4) });
    // the plain `stored` sample is 0 in both; the two extra series grow by 3 each
    expect(ingestRates(previous, next).storedPerSecond).toBe(6);
  });

  it('says nothing on a first read', () => {
    expect(ingestRates(null, feed(1))).toEqual({ storedPerSecond: null, lagSeconds: null });
  });

  it('says nothing when either feed is stale', () => {
    const none = { storedPerSecond: null, lagSeconds: null };
    expect(ingestRates(feed(0, {}, true), feed(1))).toEqual(none);
    expect(ingestRates(feed(0), feed(1, {}, true))).toEqual(none);
  });

  it('says nothing when the reads have no time or no order between them', () => {
    const none = { storedPerSecond: null, lagSeconds: null };
    expect(ingestRates(feed(5), feed(5))).toEqual(none);
    expect(ingestRates(feed(5), feed(4))).toEqual(none);
    expect(ingestRates({ ...feed(0), lastOkAt: null }, feed(1))).toEqual(none);
    expect(ingestRates(feed(0), { ...feed(1), lastOkAt: 'not a date' })).toEqual(none);
  });

  it('says nothing when a counter went backwards (ingest restarted)', () => {
    const rates = ingestRates(
      feed(0, { stored: 500, sum: 20, count: 500 }),
      feed(1, { stored: 3, sum: 0.1, count: 3 }),
    );
    expect(rates).toEqual({ storedPerSecond: null, lagSeconds: null });
  });

  it('has no lag when nothing was written between the reads', () => {
    const rates = ingestRates(
      feed(0, { stored: 10, sum: 1, count: 10 }),
      feed(1, { stored: 10, sum: 1, count: 10 }),
    );
    expect(rates.storedPerSecond).toBe(0);
    expect(rates.lagSeconds).toBeNull();
  });

  it('gives only what ingest exports', () => {
    const bare = (second: number, value: number): MetricsFeed => ({
      lastOkAt: at(second),
      stale: false,
      samples: [{ name: 'telemetry_readings_total', labels: { result: 'stored' }, value }],
    });
    expect(ingestRates(bare(0, 1), bare(1, 4))).toEqual({
      storedPerSecond: 3,
      lagSeconds: null,
    });
    const empty: MetricsFeed = { lastOkAt: at(1), stale: false, samples: [] };
    expect(ingestRates(bare(0, 1), empty)).toEqual({ storedPerSecond: null, lagSeconds: null });
  });
});

describe('storedReadings', () => {
  it('is the total of the stored readings', () => {
    expect(storedReadings(feed(0, { stored: 42 }))).toBe(42);
  });

  it('counts only stored, not duplicates', () => {
    // `feed` also has a `duplicate` sample of 99
    expect(storedReadings(feed(0, { stored: 1 }))).toBe(1);
  });

  it('is null when the feed is stale or the counter was not exported', () => {
    expect(storedReadings(feed(0, { stored: 42 }, true))).toBeNull();
    expect(storedReadings({ lastOkAt: at(0), stale: false, samples: [] })).toBeNull();
  });
});

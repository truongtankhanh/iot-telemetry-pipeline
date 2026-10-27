import { describe, expect, it, vi } from 'vitest';
import type { MetricSample, MetricsFeed } from '../api/types';
import { SessionMetricsStore } from './sessionMetricsStore';

const T0 = Date.parse('2026-10-27T09:00:00.000Z');

/** One read of ingest `second` seconds after T0, with the cumulative counters it would have shown. */
function feed(
  second: number,
  counters: {
    messages?: number;
    stored?: number;
    lagSum?: number;
    lagCount?: number;
    flush?: { fast: number; slow: number };
    buffered?: number;
  } = {},
): MetricsFeed {
  const { messages = 0, stored = 0, lagSum = 0, lagCount = 0, flush, buffered = 0 } = counters;
  const samples: MetricSample[] = [
    { name: 'telemetry_messages_total', labels: { result: 'accepted' }, value: messages },
    { name: 'telemetry_readings_total', labels: { result: 'stored' }, value: stored },
    { name: 'telemetry_ingest_lag_seconds_sum', labels: {}, value: lagSum },
    { name: 'telemetry_ingest_lag_seconds_count', labels: {}, value: lagCount },
    { name: 'telemetry_buffered_readings', labels: {}, value: buffered },
  ];
  if (flush !== undefined) {
    // 0.01 s and 0.1 s buckets: `fast` batches took 10 ms or less, `slow` took between 10 and 100 ms.
    samples.push(
      {
        name: 'telemetry_flush_duration_seconds_bucket',
        labels: { le: '0.01' },
        value: flush.fast,
      },
      {
        name: 'telemetry_flush_duration_seconds_bucket',
        labels: { le: '0.1' },
        value: flush.fast + flush.slow,
      },
      {
        name: 'telemetry_flush_duration_seconds_bucket',
        labels: { le: '+Inf' },
        value: flush.fast + flush.slow,
      },
    );
  }
  return { samples, lastOkAt: new Date(T0 + second * 1000).toISOString(), stale: false };
}

const stale: MetricsFeed = { samples: [], lastOkAt: new Date(T0).toISOString(), stale: true };

describe('SessionMetricsStore', () => {
  it('starts with no points', () => {
    expect(new SessionMetricsStore().get()).toEqual({ points: [] });
  });

  it('makes a first read a point with unknown rates and the gauge it can read', () => {
    const store = new SessionMetricsStore();
    store.record(feed(0, { messages: 100, buffered: 12 }));
    expect(store.get().points).toEqual([
      {
        at: T0,
        messagesPerS: null,
        storedPerS: null,
        lagMeanS: null,
        flushP95S: null,
        buffered: 12,
      },
    ]);
  });

  it('works the rates out of two reads', () => {
    const store = new SessionMetricsStore();
    store.record(feed(0, { messages: 100, stored: 200, lagSum: 10, lagCount: 100 }));
    store.record(
      feed(2, {
        messages: 700,
        stored: 1400,
        lagSum: 10 + 120,
        lagCount: 100 + 600,
        flush: { fast: 0, slow: 0 },
        buffered: 30,
      }),
    );
    const last = store.get().points.at(-1);
    expect(last).toMatchObject({
      at: T0 + 2000,
      messagesPerS: 300,
      storedPerS: 600,
      buffered: 30,
    });
    // 120 s of lag over 600 readings written in the window.
    expect(last?.lagMeanS).toBeCloseTo(0.2, 6);
  });

  it('takes the flush p95 from the batches of the window, not from the life of the process', () => {
    const store = new SessionMetricsStore();
    // Before the window: 1,000 fast batches. In the window: 90 fast and 10 slow ones.
    store.record(feed(0, { flush: { fast: 1000, slow: 0 } }));
    store.record(feed(1, { flush: { fast: 1090, slow: 10 } }));
    // 95 % of 100 is the 95th batch: 90 are at or below 10 ms, so it is the 5th of 10 in the 10 ms to 100 ms bucket.
    expect(store.get().points.at(-1)?.flushP95S).toBeCloseTo(0.055, 6);
  });

  it('has no flush figure for a window in which nothing was flushed', () => {
    const store = new SessionMetricsStore();
    store.record(feed(0, { flush: { fast: 10, slow: 0 } }));
    store.record(feed(1, { flush: { fast: 10, slow: 0 } }));
    expect(store.get().points.at(-1)?.flushP95S).toBeNull();
  });

  it('gives no rate for a counter that went back (ingest restarted), and not a negative one', () => {
    const store = new SessionMetricsStore();
    store.record(feed(0, { messages: 5000, stored: 9000 }));
    store.record(feed(1, { messages: 40, stored: 80 }));
    expect(store.get().points.at(-1)).toMatchObject({ messagesPerS: null, storedPerS: null });
  });

  it('ignores a read it has seen or one older than its last point, and tells nobody', () => {
    const store = new SessionMetricsStore();
    store.record(feed(5, { messages: 100 }));
    const before = store.get();
    const listener = vi.fn();
    store.subscribe(listener);
    store.record(feed(5, { messages: 100 }));
    store.record(feed(3, { messages: 50 }));
    expect(store.get()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('tells its listeners of each new point', () => {
    const store = new SessionMetricsStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.record(feed(0));
    store.record(feed(1));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get().points).toHaveLength(2);
  });

  it('does not take a rate across a gap: a stale read ends the chain', () => {
    const store = new SessionMetricsStore();
    store.record(feed(0, { messages: 100 }));
    store.record(stale);
    store.record(feed(10, { messages: 9000 }));
    const points = store.get().points;
    expect(points).toHaveLength(2);
    expect(points.at(-1)).toMatchObject({ at: T0 + 10_000, messagesPerS: null });
  });

  it('keeps only the newest points up to its capacity', () => {
    const store = new SessionMetricsStore(3);
    for (let second = 0; second < 5; second += 1) store.record(feed(second));
    expect(store.get().points.map((point) => point.at)).toEqual([T0 + 2000, T0 + 3000, T0 + 4000]);
  });

  it('clears, forgets the read the next one would be compared with, and stops telling an unsubscribed listener', () => {
    const store = new SessionMetricsStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.record(feed(0, { messages: 100 }));
    store.clear();
    expect(store.get()).toEqual({ points: [] });
    store.record(feed(1, { messages: 200 }));
    expect(store.get().points.at(-1)?.messagesPerS).toBeNull();

    stop();
    listener.mockClear();
    store.record(feed(2, { messages: 300 }));
    expect(listener).not.toHaveBeenCalled();
  });
});

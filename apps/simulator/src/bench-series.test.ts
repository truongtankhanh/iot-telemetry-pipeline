import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { queueDelayS, rampUpEndS, readBuckets, windowQuantile } from './bench-series.ts';
import type { Sample } from './prometheus-text.ts';

const NAME = 'telemetry_flush_duration_seconds';

/** The `_bucket` samples of a histogram with the given cumulative counts, `+Inf` last. */
function buckets(counts: [le: string, count: number][], name: string = NAME): Sample[] {
  return counts.map(([le, count]) => ({ name: `${name}_bucket`, labels: { le }, value: count }));
}

describe('readBuckets', () => {
  it('reads the buckets of one histogram, sorted by le with +Inf last', () => {
    const samples: Sample[] = [
      ...buckets([
        ['+Inf', 10],
        ['0.01', 2],
        ['0.005', 1],
      ]),
      { name: `${NAME}_count`, labels: {}, value: 10 },
      ...buckets([['0.005', 99]], 'telemetry_ingest_lag_seconds'),
    ];
    assert.deepEqual(readBuckets(samples, NAME), [
      { le: 0.005, count: 1 },
      { le: 0.01, count: 2 },
      { le: Infinity, count: 10 },
    ]);
  });

  it('adds the series that share an le and skips a sample whose le is not a number', () => {
    const samples: Sample[] = [
      { name: `${NAME}_bucket`, labels: { le: '0.1', zone: 'a' }, value: 2 },
      { name: `${NAME}_bucket`, labels: { le: '0.1', zone: 'b' }, value: 3 },
      { name: `${NAME}_bucket`, labels: { le: 'many' }, value: 7 },
      { name: `${NAME}_bucket`, labels: {}, value: 7 },
    ];
    assert.deepEqual(readBuckets(samples, NAME), [{ le: 0.1, count: 5 }]);
  });

  it('is empty when the histogram is not there', () => {
    assert.deepEqual(readBuckets([], NAME), []);
  });
});

describe('windowQuantile', () => {
  const read = (counts: [string, number][]) => readBuckets(buckets(counts), NAME);

  it('interpolates inside one bucket', () => {
    const before = read([
      ['0.01', 0],
      ['0.1', 0],
      ['+Inf', 0],
    ]);
    // 10 observations, all between 0.01 and 0.1: the median is half way through that bucket.
    const after = read([
      ['0.01', 0],
      ['0.1', 10],
      ['+Inf', 10],
    ]);
    assert.ok(Math.abs(windowQuantile(before, after, 0.5)! - 0.055) < 1e-9);
  });

  it('finds the bucket that holds the rank across two buckets', () => {
    const before = read([
      ['0.01', 0],
      ['0.1', 0],
      ['+Inf', 0],
    ]);
    // 90 below 10 ms and 10 between 10 ms and 100 ms: p95 is half way through the second bucket.
    const after = read([
      ['0.01', 90],
      ['0.1', 100],
      ['+Inf', 100],
    ]);
    assert.ok(Math.abs(windowQuantile(before, after, 0.95)! - 0.055) < 1e-9);
    assert.ok(Math.abs(windowQuantile(before, after, 0.5)! - (0.01 * 50) / 90) < 1e-9);
  });

  it('uses the counts of the window, not the life of the process', () => {
    // A long, slow past (everything above 0.1) and a fast last second (everything below 10 ms).
    const before = read([
      ['0.01', 0],
      ['0.1', 0],
      ['+Inf', 1000],
    ]);
    const after = read([
      ['0.01', 20],
      ['0.1', 20],
      ['+Inf', 1020],
    ]);
    const p95 = windowQuantile(before, after, 0.95)!;
    assert.ok(p95 <= 0.01, `p95 of the window is ${p95}`);
  });

  it('is null when nothing was observed in the window', () => {
    const same = read([
      ['0.01', 500],
      ['0.1', 900],
      ['+Inf', 1000],
    ]);
    assert.equal(windowQuantile(same, same, 0.95), null);
  });

  it('is null when a counter went back (ingest restarted) and without an earlier read', () => {
    const before = read([
      ['0.01', 500],
      ['+Inf', 1000],
    ]);
    const restarted = read([
      ['0.01', 3],
      ['+Inf', 5],
    ]);
    assert.equal(windowQuantile(before, restarted, 0.95), null);
    assert.equal(windowQuantile(undefined, restarted, 0.95), null);
    assert.equal(windowQuantile(before, [], 0.95), null);
  });

  it('answers the last finite bound when the rank falls in the +Inf bucket', () => {
    const before = read([
      ['1', 0],
      ['60', 0],
      ['+Inf', 0],
    ]);
    const after = read([
      ['1', 0],
      ['60', 0],
      ['+Inf', 40],
    ]);
    assert.equal(windowQuantile(before, after, 0.95), 60);
  });
});

describe('queueDelayS', () => {
  it('is the readings in flight over the rate they are stored at', () => {
    assert.equal(queueDelayS(100, 50), 2);
  });

  it('is zero with nothing in flight, even when nothing is being stored', () => {
    assert.equal(queueDelayS(0, 100), 0);
    assert.equal(queueDelayS(0, 0), 0);
  });

  it('is unknown, not infinite, when something is in flight and nothing is being stored', () => {
    assert.equal(queueDelayS(100, 0), null);
    assert.equal(queueDelayS(100, Number.NaN), null);
  });
});

describe('rampUpEndS', () => {
  const at = (rows: [number, number][]) => rows.map(([t, published]) => ({ t, published }));

  it('ends where a rising rate first reaches 90 % of the median rate', () => {
    // Rates per second: 1,000, 4,000, 9,000, 10,000, 10,000, 10,000, then the wait for storage (0).
    const points = at([
      [0, 0],
      [1, 1000],
      [2, 5000],
      [3, 14000],
      [4, 24000],
      [5, 34000],
      [6, 44000],
      [7, 50000],
      [8, 50000],
      [9, 50000],
    ]);
    assert.equal(rampUpEndS(points, 50000), 2);
  });

  it('is the first point for a run that was at speed from the start', () => {
    const points = at([
      [0, 0],
      [1, 8000],
      [2, 16000],
      [3, 24000],
    ]);
    assert.equal(rampUpEndS(points, 100000), 0);
  });

  it('does not let the wait for storage lower the median', () => {
    // Publishing ends at t = 3; the long wait afterwards has a rate of zero.
    const points = at([
      [0, 0],
      [1, 5000],
      [2, 10000],
      [3, 15000],
      [4, 15000],
      [5, 15000],
      [6, 15000],
      [7, 15000],
      [8, 15000],
    ]);
    assert.equal(rampUpEndS(points, 15000), 0);
  });

  it('is null for a run with fewer than three points or no message published', () => {
    assert.equal(
      rampUpEndS(
        at([
          [0, 0],
          [1, 100],
        ]),
        100,
      ),
      null,
    );
    assert.equal(
      rampUpEndS(
        at([
          [0, 0],
          [1, 0],
          [2, 0],
        ]),
        100,
      ),
      null,
    );
    assert.equal(rampUpEndS([], 100), null);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { benchmarkFixture } from '../api/fixtures/benchmarkFixtures';
import type {
  BenchmarkDetail,
  BenchmarkPoint,
  BenchmarkRunDetail,
  BenchmarkRunSummary,
  BenchmarkSummary,
} from '../api/types';
import { BenchmarkStore, MAX_RUNS } from './benchmarkStore';

const going = benchmarkFixture.current as BenchmarkRunDetail;

/** A run as the stream's event sends it: the summary, no series. */
function summaryOf(id: number, change: Partial<BenchmarkRunSummary> = {}): BenchmarkRunSummary {
  const summary: Partial<BenchmarkRunDetail> = structuredClone(going);
  delete summary.series;
  return { ...(summary as BenchmarkRunSummary), id, ...change };
}

const point = (t: number, published = t * 1000): BenchmarkPoint => ({
  t,
  published,
  stored: published * 2,
  buffered: 800,
  flushP95S: 0.018,
  queueDelayS: 0.14,
});

const ended = (id: number, change: Partial<BenchmarkRunSummary> = {}) =>
  summaryOf(id, {
    phase: 'ended',
    outcome: 'completed',
    comparable: true,
    endedAt: '2026-10-27T09:31:00.000Z',
    elapsedMs: 20_000,
    published: 100_000,
    ...change,
  });

const summaryWith = (
  current: BenchmarkRunSummary | null,
  runs: BenchmarkRunSummary[] = [],
): BenchmarkSummary => ({
  available: true,
  reason: null,
  database: 'localhost:5433/telemetry',
  maxMessages: 250_000,
  running: current !== null,
  current,
  runs,
});

const detailWith = (
  current: BenchmarkRunDetail | null,
  runs: BenchmarkRunDetail[] = [],
): BenchmarkDetail => ({ ...benchmarkFixture, running: current !== null, current, runs });

describe('BenchmarkStore', () => {
  it('starts empty, with no run going', () => {
    const store = new BenchmarkStore();
    expect(store.get()).toEqual({ current: null, runs: [], status: null });
  });

  it('holds the run an event brings, with its first point, and says which run is going', () => {
    const store = new BenchmarkStore();
    store.applyEvent({ run: summaryOf(1, { phase: 'starting' }), point: null });
    expect(store.get().status).toEqual({ id: 1, phase: 'starting' });
    expect(store.get().current?.series).toEqual([]);

    store.applyEvent({
      run: summaryOf(1, { phase: 'publishing', elapsedMs: 1000 }),
      point: point(0),
    });
    expect(store.get().status).toEqual({ id: 1, phase: 'publishing' });
    expect(store.get().current?.series).toEqual([point(0)]);
  });

  it('adds a point to the series in order, and tells its listeners each time', () => {
    const store = new BenchmarkStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyEvent({ run: summaryOf(1, { elapsedMs: 1000 }), point: point(1) });
    store.applyEvent({ run: summaryOf(1, { elapsedMs: 2000 }), point: point(2) });
    expect(store.get().current?.series.map((p) => p.t)).toEqual([1, 2]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores an event it has seen: same snapshot, nobody told', () => {
    const store = new BenchmarkStore();
    const event = { run: summaryOf(1, { elapsedMs: 1000 }), point: point(1) };
    store.applyEvent(event);
    const before = store.get();
    const listener = vi.fn();
    store.subscribe(listener);
    store.applyEvent(structuredClone(event));
    expect(store.get()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the same status object while the run stays in a phase, and a new one when the phase changes', () => {
    const store = new BenchmarkStore();
    store.applyEvent({ run: summaryOf(1, { elapsedMs: 1000 }), point: point(1) });
    const status = store.get().status;
    store.applyEvent({ run: summaryOf(1, { elapsedMs: 2000 }), point: point(2) });
    expect(store.get().status).toBe(status);
    store.applyEvent({ run: summaryOf(1, { phase: 'waiting', elapsedMs: 3000 }), point: null });
    expect(store.get().status).not.toBe(status);
    expect(store.get().status).toEqual({ id: 1, phase: 'waiting' });
  });

  it('moves a run that ended among the finished ones, series and all, and nothing is going', () => {
    const store = new BenchmarkStore();
    store.applyEvent({ run: summaryOf(1, { elapsedMs: 1000 }), point: point(1) });
    store.applyEvent({ run: ended(1), point: null });
    const { current, runs, status } = store.get();
    expect(current).toBeNull();
    expect(status).toBeNull();
    expect(runs.map((run) => run.id)).toEqual([1]);
    expect(runs[0]?.outcome).toBe('completed');
    expect(runs[0]?.series.map((p) => p.t)).toEqual([1]);
  });

  it('does not turn a run that ended back into one that publishes when an older summary arrives', () => {
    const store = new BenchmarkStore();
    store.applyEvent({ run: ended(3), point: null });
    store.applyEvent({ run: summaryOf(3, { phase: 'publishing', elapsedMs: 5000 }), point: null });
    expect(store.get().current).toBeNull();
    expect(store.get().runs[0]?.phase).toBe('ended');
  });

  describe('the snapshot of the stream and the read that follows it', () => {
    it('holds the summary without series, and the read adds the series', () => {
      const store = new BenchmarkStore();
      store.seedSummary(summaryWith(summaryOf(3), [ended(2), ended(1, { outcome: 'failed' })]));
      expect(store.get().status).toEqual({ id: 3, phase: 'publishing' });
      expect(store.get().current?.series).toEqual([]);
      expect(store.get().runs.map((run) => run.id)).toEqual([2, 1]);

      store.seedDetail(benchmarkFixture);
      expect(store.get().current?.series).toHaveLength(going.series.length);
      expect(store.get().runs[0]?.series.length).toBeGreaterThan(0);
    });

    it('keeps what the events brought while the read was on its way', () => {
      const store = new BenchmarkStore();
      store.seedSummary(summaryWith(summaryOf(3)));
      store.applyEvent({ run: summaryOf(3, { elapsedMs: 11_000 }), point: point(11) });

      store.seedDetail(detailWith(going));
      const times = store.get().current?.series.map((p) => p.t);
      expect(times).toEqual([...going.series.map((p) => p.t), 11]);
    });

    it('does not let a read that is older than an event undo the event', () => {
      const store = new BenchmarkStore();
      store.applyEvent({ run: ended(3, { elapsedMs: 15_000 }), point: null });
      store.seedDetail(detailWith(going));
      expect(store.get().current).toBeNull();
      expect(store.get().runs[0]?.phase).toBe('ended');
    });

    it('forgets what it held when the simulator started again and numbered from 1', () => {
      const store = new BenchmarkStore();
      store.seedSummary(summaryWith(summaryOf(5), [ended(4), ended(3)]));
      store.seedSummary(summaryWith(null, []));
      expect(store.get()).toEqual({ current: null, runs: [], status: null });

      store.seedSummary(summaryWith(summaryOf(1, { phase: 'starting' })));
      expect(store.get().status).toEqual({ id: 1, phase: 'starting' });
    });

    it('does not forget on a summary that is as new as what it holds', () => {
      const store = new BenchmarkStore();
      store.applyEvent({ run: summaryOf(3, { elapsedMs: 4000 }), point: point(4) });
      store.seedSummary(summaryWith(summaryOf(3)));
      expect(store.get().current?.series).toHaveLength(1);
    });
  });

  it('keeps the last ten finished runs, newest first', () => {
    const store = new BenchmarkStore();
    for (let id = 1; id <= MAX_RUNS + 2; id += 1) store.applyEvent({ run: ended(id), point: null });
    const ids = store.get().runs.map((run) => run.id);
    expect(ids).toHaveLength(MAX_RUNS);
    expect(ids[0]).toBe(MAX_RUNS + 2);
    expect(ids.at(-1)).toBe(3);
  });

  it('clears, and tells the listeners once', () => {
    const store = new BenchmarkStore();
    store.applyEvent({ run: ended(1), point: null });
    const listener = vi.fn();
    store.subscribe(listener);
    store.clear();
    expect(store.get()).toEqual({ current: null, runs: [], status: null });
    expect(listener).toHaveBeenCalledTimes(1);
    store.clear();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops telling a listener that unsubscribed', () => {
    const store = new BenchmarkStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    stop();
    store.applyEvent({ run: summaryOf(1), point: null });
    expect(listener).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservationEvent } from '../api/types';
import { ObservationLog } from './observationLog';

const T0 = Date.parse('2026-10-20T09:00:00.000Z');

const event = (id: number, kind: ObservationEvent['kind'] = 'engine-state'): ObservationEvent => ({
  id,
  at: new Date(T0 + id * 1000).toISOString(),
  kind,
  data: { n: id },
});

const ids = (log: ObservationLog) => log.snapshot().events.map((e) => e.id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ObservationLog', () => {
  it('starts empty, with no newest id and no read going on', () => {
    const log = new ObservationLog();
    expect(log.snapshot()).toEqual({ events: [], newestId: 0, loading: null });
    expect(log.newestId()).toBe(0);
  });

  it('holds recorded events newest first once its listeners have been told', () => {
    const log = new ObservationLog({ notifyEveryMs: 1000 });
    log.record(event(1));
    log.record(event(2));
    log.record(event(3));
    // Between notifications a reader sees the same, older, object.
    expect(ids(log)).toEqual([]);
    expect(log.newestId()).toBe(3);

    vi.advanceTimersByTime(1000);
    expect(ids(log)).toEqual([3, 2, 1]);
    expect(log.snapshot().newestId).toBe(3);
  });

  it('tells its listeners at most once per interval, with the same object until then', () => {
    const log = new ObservationLog({ notifyEveryMs: 1000 });
    const listener = vi.fn();
    log.subscribe(listener);
    log.record(event(1));
    log.record(event(2));
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);
    const first = log.snapshot();
    expect(log.snapshot()).toBe(first);

    log.record(event(3));
    expect(log.snapshot()).toBe(first);
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(log.snapshot()).not.toBe(first);
  });

  it('stops telling a listener that unsubscribed, and a disposed log tells no one', () => {
    const log = new ObservationLog({ notifyEveryMs: 1000 });
    const listener = vi.fn();
    const off = log.subscribe(listener);
    off();
    log.record(event(1));
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();

    const other = vi.fn();
    log.subscribe(other);
    log.record(event(2));
    log.dispose();
    vi.advanceTimersByTime(5000);
    expect(other).not.toHaveBeenCalled();
    expect(log.newestId()).toBe(2);
  });

  it('keeps an event once, however many times it arrives', () => {
    const log = new ObservationLog();
    log.record(event(1));
    log.record(event(1));
    log.seed([event(1), event(2)]);
    log.seed([event(2)]);
    expect(ids(log)).toEqual([2, 1]);
  });

  it('places a late event where its id says', () => {
    const log = new ObservationLog();
    log.record(event(1));
    log.record(event(3));
    log.record(event(2));
    vi.advanceTimersByTime(1000);
    expect(ids(log)).toEqual([3, 2, 1]);
  });

  it('keeps only the newest events up to its capacity', () => {
    const log = new ObservationLog({ capacity: 3 });
    for (let id = 1; id <= 5; id += 1) log.record(event(id));
    vi.advanceTimersByTime(1000);
    expect(ids(log)).toEqual([5, 4, 3]);
    // An evicted id is forgotten, so it could be recorded again.
    log.record(event(1));
    vi.advanceTimersByTime(1000);
    expect(ids(log)).toEqual([5, 4, 3]);
  });

  it('holds 5,000 events by default and forgets the oldest', () => {
    const log = new ObservationLog();
    log.seed(Array.from({ length: 5200 }, (_, i) => event(5200 - i)));
    const held = ids(log);
    expect(held).toHaveLength(5000);
    expect(held[0]).toBe(5200);
    expect(held.at(-1)).toBe(201);
  });
});

describe('ObservationLog.seed', () => {
  it('accepts a read newest first and tells its listeners at once', () => {
    const log = new ObservationLog();
    const listener = vi.fn();
    log.subscribe(listener);
    log.seed([event(3), event(2), event(1)]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids(log)).toEqual([3, 2, 1]);
  });

  it('keeps an event recorded while the read was on its way, which is newer than the read', () => {
    const log = new ObservationLog();
    log.record(event(10)); // arrived live during the read
    log.seed([event(9), event(8)]);
    expect(ids(log)).toEqual([10, 9, 8]);
  });

  it('cancels a pending notification, since it has just told everyone', () => {
    const log = new ObservationLog({ notifyEveryMs: 1000 });
    const listener = vi.fn();
    log.subscribe(listener);
    log.record(event(2));
    log.seed([event(1)]);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids(log)).toEqual([2, 1]);
  });
});

describe('ObservationLog.clear and setLoading', () => {
  it('forgets everything, ids included, so a restarted simulator can begin again at 1', () => {
    const log = new ObservationLog();
    log.seed([event(2), event(1)]);
    log.clear();
    expect(log.snapshot()).toEqual({ events: [], newestId: 0, loading: null });
    log.seed([event(1)]);
    expect(ids(log)).toEqual([1]);
  });

  it('reports how far a read has got, and tells at once', () => {
    const log = new ObservationLog();
    const listener = vi.fn();
    log.subscribe(listener);
    log.setLoading(0);
    expect(log.snapshot().loading).toBe(0);
    log.setLoading(500);
    expect(log.snapshot().loading).toBe(500);
    log.setLoading(500);
    expect(listener).toHaveBeenCalledTimes(2);
    log.setLoading(null);
    expect(log.snapshot().loading).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

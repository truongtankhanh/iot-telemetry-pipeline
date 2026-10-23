import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedMessage } from '../api/types';
import { HistoryStore, seriesKey } from './history';

const T0 = Date.parse('2026-10-20T09:00:00.000Z');

/** A published message for a device, `atS` seconds after T0, carrying these metrics. */
const message = (
  deviceId: string,
  atS: number,
  metrics: Record<string, unknown> = { temperature_c: 22.5 },
  seq = atS,
): PublishedMessage => {
  const ts = new Date(T0 + atS * 1000).toISOString();
  return {
    deviceId,
    topic: `campus/BLD-DC/${deviceId}/telemetry`,
    payload: JSON.stringify({ seq, ts, metrics }),
    seq,
    ts,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('HistoryStore series', () => {
  it('keeps the readings of each metric of each device, oldest first', () => {
    const history = new HistoryStore();
    history.record(message('a', 0, { temperature_c: 22.5, humidity_pct: 45 }));
    history.record(message('a', 2, { temperature_c: 22.7, humidity_pct: 46 }));
    history.record(message('b', 1, { temperature_c: 30 }));

    expect(history.series('a', 'temperature_c')).toEqual([
      { t: T0, v: 22.5 },
      { t: T0 + 2000, v: 22.7 },
    ]);
    expect(history.series('a', 'humidity_pct').map((s) => s.v)).toEqual([45, 46]);
    expect(history.series('b', 'temperature_c')).toEqual([{ t: T0 + 1000, v: 30 }]);
    expect(history.series('b', 'humidity_pct')).toEqual([]);
    expect(history.series('ghost', 'temperature_c')).toEqual([]);
  });

  it('hands out a copy, so a caller cannot change what is kept', () => {
    const history = new HistoryStore();
    history.record(message('a', 0));
    history.series('a', 'temperature_c').push({ t: 1, v: 1 });
    expect(history.series('a', 'temperature_c')).toHaveLength(1);
  });

  it('places a late message where its time says', () => {
    const history = new HistoryStore();
    history.record(message('a', 0, { temperature_c: 1 }));
    history.record(message('a', 4, { temperature_c: 3 }));
    history.record(message('a', 2, { temperature_c: 2 }));
    expect(history.series('a', 'temperature_c').map((s) => s.v)).toEqual([1, 2, 3]);
  });

  it('drops readings older than the window, measured from the newest', () => {
    const history = new HistoryStore({ windowMs: 10_000 });
    for (const atS of [0, 4, 8, 12, 16]) history.record(message('a', atS, { temperature_c: atS }));
    expect(history.series('a', 'temperature_c').map((s) => s.v)).toEqual([8, 12, 16]);
  });

  it('keeps at most maxPoints per series', () => {
    const history = new HistoryStore({ maxPoints: 3 });
    for (let i = 0; i < 10; i++) history.record(message('a', i, { temperature_c: i }));
    expect(history.series('a', 'temperature_c').map((s) => s.v)).toEqual([7, 8, 9]);
  });

  it('keeps no reading from a payload that has none, and counts a message with a time as heard', () => {
    const history = new HistoryStore();
    history.record({ ...message('a', 0), payload: 'not json' });
    history.record({ ...message('a', 1), payload: JSON.stringify({ seq: 1 }) });
    history.record({ ...message('a', 2), payload: JSON.stringify({ metrics: [1, 2] }) });
    history.record(
      message('a', 3, { temperature_c: 'hot', humidity_pct: null, co2_ppm: Number.NaN }),
    );
    history.record({ ...message('a', 4), ts: 'yesterday' });
    expect(history.series('a', 'temperature_c')).toEqual([]);
    expect(history.series('a', 'humidity_pct')).toEqual([]);
    expect(history.series('a', '0')).toEqual([]); // `metrics: [1, 2]` is not a set of named metrics
    // A message with a time was heard, even when its payload gave no reading; one without a usable time was not.
    expect(history.lastSeen('a')).toBe(T0 + 3000);
  });

  it('keeps a metric that the contract does not know: the history does not judge names', () => {
    const history = new HistoryStore();
    history.record(message('a', 0, { pressure_hpa: 1000 }));
    expect(history.series('a', 'pressure_hpa')).toEqual([{ t: T0, v: 1000 }]);
  });
});

describe('HistoryStore last message', () => {
  it('knows when a device was last measured and what it last said', () => {
    const history = new HistoryStore();
    expect(history.lastSeen('a')).toBeNull();
    expect(history.lastPayload('a')).toBeNull();
    const first = message('a', 0);
    const second = message('a', 2);
    history.record(first);
    history.record(second);
    expect(history.lastSeen('a')).toBe(T0 + 2000);
    expect(history.lastPayload('a')).toEqual(second);
  });

  it('does not let a late message replace a newer last payload', () => {
    const history = new HistoryStore();
    const newer = message('a', 4);
    history.record(newer);
    history.record(message('a', 1));
    expect(history.lastSeen('a')).toBe(T0 + 4000);
    expect(history.lastPayload('a')).toEqual(newer);
  });
});

describe('HistoryStore seeding', () => {
  it('takes the publish log of a snapshot, oldest first', () => {
    const history = new HistoryStore();
    history.seed([message('a', 0, { temperature_c: 1 }), message('a', 2, { temperature_c: 2 })]);
    expect(history.series('a', 'temperature_c').map((s) => s.v)).toEqual([1, 2]);
    expect(history.lastSeen('a')).toBe(T0 + 2000);
  });

  it('replaces what was there, so a reconnect does not double the readings', () => {
    const history = new HistoryStore();
    history.record(message('a', 0, { temperature_c: 1 }));
    history.record(message('b', 0, { temperature_c: 9 }));
    history.seed([message('a', 0, { temperature_c: 1 }), message('a', 2, { temperature_c: 2 })]);
    expect(history.series('a', 'temperature_c').map((s) => s.v)).toEqual([1, 2]);
    expect(history.series('b', 'temperature_c')).toEqual([]);
    expect(history.lastPayload('b')).toBeNull();
  });

  it('tells the listeners of what changed at once, including a series that went away', () => {
    const history = new HistoryStore();
    history.record(message('b', 0, { temperature_c: 9 }));
    vi.advanceTimersByTime(1000);
    const gone = vi.fn();
    const fresh = vi.fn();
    history.subscribe(seriesKey('b', 'temperature_c'), gone);
    history.subscribe(seriesKey('a', 'temperature_c'), fresh);
    history.seed([message('a', 0)]);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});

describe('HistoryStore notifications', () => {
  it('tells a listener at most once per interval however many messages arrive', () => {
    const history = new HistoryStore({ notifyEveryMs: 1000 });
    const listener = vi.fn();
    history.subscribe(seriesKey('a', 'temperature_c'), listener);
    for (let i = 0; i < 15; i++) history.record(message('a', i * 0.05));
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);

    history.record(message('a', 10));
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('tells only the listeners of the keys that changed, and bumps only their version', () => {
    const history = new HistoryStore();
    const a = vi.fn();
    const b = vi.fn();
    const device = vi.fn();
    history.subscribe(seriesKey('a', 'temperature_c'), a);
    history.subscribe(seriesKey('b', 'temperature_c'), b);
    history.subscribe('a', device);
    history.record(message('a', 0));
    vi.advanceTimersByTime(1000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(device).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(history.versionOf(seriesKey('a', 'temperature_c'))).toBe(1);
    expect(history.versionOf(seriesKey('b', 'temperature_c'))).toBe(0);
  });

  it('stops telling a listener that unsubscribed', () => {
    const history = new HistoryStore();
    const listener = vi.fn();
    const unsubscribe = history.subscribe('a', listener);
    unsubscribe();
    history.record(message('a', 0));
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops the pending notification on dispose, and keeps the data', () => {
    const history = new HistoryStore();
    const listener = vi.fn();
    history.subscribe('a', listener);
    history.record(message('a', 0));
    history.dispose();
    vi.advanceTimersByTime(5000);
    expect(listener).not.toHaveBeenCalled();
    expect(history.series('a', 'temperature_c')).toHaveLength(1);
  });
});

describe('HistoryStore snapshots', () => {
  it('give a reader the same array until the next notification, then a new one', () => {
    const history = new HistoryStore();
    const empty = history.snapshot('a', 'temperature_c');
    expect(empty).toEqual([]);
    expect(history.snapshot('a', 'temperature_c')).toBe(empty);

    history.record(message('a', 0));
    // Recorded, not yet announced: readers still hold the same object.
    expect(history.snapshot('a', 'temperature_c')).toBe(empty);

    vi.advanceTimersByTime(1000);
    const after = history.snapshot('a', 'temperature_c');
    expect(after).not.toBe(empty);
    expect(after).toEqual([{ t: T0, v: 22.5 }]);
    expect(history.snapshot('a', 'temperature_c')).toBe(after);
  });

  it('give a device-level reader the last message as of the last notification', () => {
    const history = new HistoryStore();
    expect(history.deviceSnapshot('a')).toEqual({ lastSeen: null, last: null });
    const first = message('a', 0);
    history.record(first);
    expect(history.deviceSnapshot('a').last).toBeNull();
    vi.advanceTimersByTime(1000);
    const snapshot = history.deviceSnapshot('a');
    expect(snapshot).toEqual({ lastSeen: T0, last: first });
    expect(history.deviceSnapshot('a')).toBe(snapshot);
  });

  it('are renewed at once by a seed', () => {
    const history = new HistoryStore();
    const before = history.snapshot('a', 'temperature_c');
    history.seed([message('a', 0)]);
    expect(history.snapshot('a', 'temperature_c')).not.toBe(before);
    expect(history.snapshot('a', 'temperature_c')).toHaveLength(1);
  });
});

describe('HistoryStore and a republished message', () => {
  const republished = (deviceId: string, atS: number, value: number): PublishedMessage => ({
    ...message(deviceId, atS, { temperature_c: value }),
    fault: 'republish',
  });

  it('adds no sample, does not replace the last message and does not move the last seen, when recorded', () => {
    const history = new HistoryStore();
    const original = message('a', 0, { temperature_c: 22.5 });
    history.record(original);
    history.record(republished('a', 5, 99));
    vi.advanceTimersByTime(1000);

    expect(history.series('a', 'temperature_c')).toEqual([{ t: T0, v: 22.5 }]);
    expect(history.lastPayload('a')).toBe(original);
    expect(history.lastSeen('a')).toBe(T0);
  });

  it('leaves it out of a seed too', () => {
    const history = new HistoryStore();
    history.seed([message('a', 0), republished('a', 0, 22.5)]);
    expect(history.series('a', 'temperature_c')).toHaveLength(1);
  });

  it('does not make a device known that has only a republished message', () => {
    const history = new HistoryStore();
    history.record(republished('a', 0, 22.5));
    vi.advanceTimersByTime(1000);
    expect(history.lastSeen('a')).toBeNull();
    expect(history.deviceSnapshot('a')).toEqual({ lastSeen: null, last: null });
  });

  it('still records a copy made by the duplicate fault, as it always did', () => {
    const history = new HistoryStore();
    history.record(message('a', 0, { temperature_c: 22.5 }));
    history.record({ ...message('a', 0, { temperature_c: 22.5 }), fault: 'duplicate' });
    expect(history.series('a', 'temperature_c')).toHaveLength(2);
  });
});

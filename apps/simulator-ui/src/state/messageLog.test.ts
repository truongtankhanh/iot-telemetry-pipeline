import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedMessage, SamplingReport } from '../api/types';
import { MESSAGE_CAPACITY, MESSAGE_NOTIFY_MS, MessageLog } from './messageLog';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const message = (id: number, overrides: Partial<PublishedMessage> = {}): PublishedMessage => ({
  id,
  at: '2026-10-19T02:14:31.000Z',
  ackMs: 3,
  deviceId: 'dc-env-01',
  topic: 'campus/BLD-DC/dc-env-01/telemetry',
  payload: JSON.stringify({ seq: id, metrics: { temperature_c: 20 } }),
  seq: id,
  ts: '2026-10-19T02:14:31.000Z',
  ...overrides,
});

const report = (overrides: Partial<SamplingReport> = {}): SamplingReport => ({
  total: 1000,
  skipped: 750,
  forwarded: 250,
  windowMs: 1000,
  budgetPerS: 250,
  active: true,
  ...overrides,
});

const ids = (log: MessageLog) => log.snapshot().rows.map((row) => row.id);
const tick = () => vi.advanceTimersByTime(MESSAGE_NOTIFY_MS);

describe('MessageLog: live messages', () => {
  it('is empty before anything arrives', () => {
    const snapshot = new MessageLog().snapshot();
    expect(snapshot).toMatchObject({
      rows: [],
      total: 0,
      sampling: null,
      newestId: 0,
      clearedBefore: 0,
    });
  });

  it('keeps the newest 200, newest first, and counts every one', () => {
    const log = new MessageLog();
    for (let id = 1; id <= 250; id++) log.record(message(id));
    tick();
    const rows = log.snapshot().rows;
    expect(rows).toHaveLength(MESSAGE_CAPACITY);
    expect(rows[0]?.id).toBe(250);
    expect(rows.at(-1)?.id).toBe(51);
    expect(log.snapshot().total).toBe(250);
    expect(log.snapshot().newestId).toBe(250);
  });

  it('ignores an id it already has, and a message without an id', () => {
    const log = new MessageLog();
    log.record(message(1));
    log.record(message(1));
    const withoutId = { ...message(2) } as Partial<PublishedMessage>;
    delete withoutId.id;
    log.record(withoutId as PublishedMessage);
    tick();
    expect(ids(log)).toEqual([1]);
    expect(log.snapshot().total).toBe(1);
  });

  it('puts a late message where its id says', () => {
    const log = new MessageLog();
    log.record(message(1));
    log.record(message(3));
    log.record(message(2));
    tick();
    expect(ids(log)).toEqual([3, 2, 1]);
  });

  it('tells its listeners at most once per interval, and hands out one snapshot between', () => {
    const log = new MessageLog();
    const listener = vi.fn();
    log.subscribe(listener);
    const before = log.snapshot();

    for (let id = 1; id <= 100; id++) log.record(message(id));
    expect(listener).not.toHaveBeenCalled();
    expect(log.snapshot()).toBe(before);

    tick();
    expect(listener).toHaveBeenCalledTimes(1);
    const after = log.snapshot();
    expect(after).not.toBe(before);
    expect(log.snapshot()).toBe(after);

    log.record(message(101));
    tick();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops telling a listener that unsubscribed', () => {
    const log = new MessageLog();
    const listener = vi.fn();
    const stop = log.subscribe(listener);
    stop();
    log.record(message(1));
    tick();
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps 200 rows and an exact total through 10,000 messages, with one notification per interval', () => {
    const log = new MessageLog();
    const listener = vi.fn();
    log.subscribe(listener);
    for (let id = 1; id <= 10_000; id++) log.record(message(id));
    tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(log.snapshot().rows).toHaveLength(200);
    expect(log.snapshot().total).toBe(10_000);
  });

  it('stops the pending notification when disposed, and keeps the data', () => {
    const log = new MessageLog();
    const listener = vi.fn();
    log.subscribe(listener);
    log.record(message(1));
    log.dispose();
    tick();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('MessageLog: a snapshot of the stream', () => {
  it('replaces what it holds, in any order, and tells at once', () => {
    const log = new MessageLog();
    log.record(message(1));
    const listener = vi.fn();
    log.subscribe(listener);

    log.seed([message(12), message(10), message(11)], { total: 500 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids(log)).toEqual([12, 11, 10]);
    expect(log.snapshot().total).toBe(500);
  });

  it('counts what it was given when the simulator sent no total', () => {
    const log = new MessageLog();
    log.seed([message(1), message(2)]);
    expect(log.snapshot().total).toBe(2);
  });

  it('keeps the newest 200 of a longer list, and skips a message without an id', () => {
    const log = new MessageLog();
    const many = Array.from({ length: 230 }, (_, i) => message(i + 1));
    const noId = { ...message(999) } as Partial<PublishedMessage>;
    delete noId.id;
    log.seed([...many, noId as PublishedMessage], { total: 230 });
    expect(log.snapshot().rows).toHaveLength(200);
    expect(log.snapshot().rows[0]?.id).toBe(230);
  });

  it('takes the sampling notice of the snapshot, only while it is active', () => {
    const log = new MessageLog();
    log.seed([message(1)], {
      total: 9,
      sampling: { active: true, skipped: 40, budgetPerS: 250, windowMs: 1000 },
    });
    expect(log.snapshot().sampling).toEqual({ skipped: 40, budgetPerS: 250, windowMs: 1000 });
    log.seed([message(1)], {
      total: 9,
      sampling: { active: false, skipped: 0, budgetPerS: 250, windowMs: 1000 },
    });
    expect(log.snapshot().sampling).toBeNull();
  });

  it('counts one more for each message that arrives after it', () => {
    const log = new MessageLog();
    log.seed([message(1), message(2)], { total: 7612 });
    log.record(message(3));
    log.record(message(4));
    tick();
    expect(log.snapshot().total).toBe(7614);
  });
});

describe('MessageLog: sampling reports', () => {
  it('sets the total exactly and shows the notice', () => {
    const log = new MessageLog();
    log.seed([message(1)], { total: 1 });
    const listener = vi.fn();
    log.subscribe(listener);

    log.applySampling(report());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(log.snapshot().total).toBe(1000);
    expect(log.snapshot().sampling).toEqual({ skipped: 750, budgetPerS: 250, windowMs: 1000 });
  });

  it('ends the notice with the closing report, and keeps counting from its total', () => {
    const log = new MessageLog();
    log.applySampling(report());
    log.applySampling(report({ total: 1200, skipped: 0, active: false }));
    expect(log.snapshot().sampling).toBeNull();
    expect(log.snapshot().total).toBe(1200);
    log.record(message(1));
    tick();
    expect(log.snapshot().total).toBe(1201);
  });
});

describe('MessageLog: clear', () => {
  it('hides what is there, shows what comes after, and leaves the total alone', () => {
    const log = new MessageLog();
    log.seed([message(1), message(2), message(3)], { total: 50 });
    const listener = vi.fn();
    log.subscribe(listener);

    log.clear();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ids(log)).toEqual([]);
    expect(log.snapshot().total).toBe(50);
    expect(log.snapshot().clearedBefore).toBe(3);

    log.record(message(4));
    tick();
    expect(ids(log)).toEqual([4]);
    expect(log.snapshot().total).toBe(51);
  });

  it('survives a reconnect: the next snapshot holds the same messages and they stay hidden', () => {
    const log = new MessageLog();
    log.seed([message(1), message(2)], { total: 2 });
    log.clear();
    log.seed([message(1), message(2), message(3)], { total: 3 });
    expect(ids(log)).toEqual([3]);
    expect(log.snapshot().clearedBefore).toBe(2);
  });

  it('is dropped when the simulator has started again and its ids begin at 1', () => {
    const log = new MessageLog();
    log.seed([message(1), message(2), message(3)], { total: 3 });
    log.clear();
    log.seed([message(1), message(2)], { total: 2 });
    expect(ids(log)).toEqual([2, 1]);
    expect(log.snapshot().clearedBefore).toBe(0);
  });

  it('is dropped by a restarted simulator that has published nothing yet', () => {
    const log = new MessageLog();
    log.seed([message(1), message(2)], { total: 2 });
    log.clear();
    log.seed([], { total: 0 });
    log.record(message(1));
    tick();
    expect(ids(log)).toEqual([1]);
  });

  it('can clear again, and clears nothing when nothing has been seen', () => {
    const log = new MessageLog();
    log.clear();
    expect(log.snapshot().clearedBefore).toBe(0);
    log.record(message(1));
    log.clear();
    log.record(message(2));
    log.clear();
    tick();
    expect(ids(log)).toEqual([]);
    expect(log.snapshot().clearedBefore).toBe(2);
  });
});

describe('MessageLog: has', () => {
  it('knows the messages it keeps, including the ones Clear hid, and not the ones that left or never came', () => {
    const log = new MessageLog({ capacity: 3 });
    for (let id = 1; id <= 4; id++) log.record(message(id));
    expect(log.has(4)).toBe(true);
    expect(log.has(2)).toBe(true);
    expect(log.has(1)).toBe(false); // pushed out by the capacity
    expect(log.has(99)).toBe(false);

    log.clear();
    expect(ids(log)).toEqual([]);
    expect(log.has(4)).toBe(true);
  });
});

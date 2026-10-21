import { describe, expect, it } from 'vitest';
import {
  axisTimes,
  bucketMsFor,
  bucketWord,
  density,
  handleKey,
  keyMoveHandle,
  MAX_BUCKETS,
  MIN_SPAN_MS,
  moveHandle,
  timeAtX,
  xAtTime,
} from './eventDensity';

const MIN = 60_000;
const T0 = Date.parse('2026-10-20T08:15:00.000Z');
const HOUR = { from: T0, to: T0 + 60 * MIN };

describe('the length of a stretch', () => {
  it('is a minute for the ranges up to two hours, and grows so the strip never has more than 120 bars', () => {
    expect(bucketMsFor(5 * MIN)).toBe(MIN);
    expect(bucketMsFor(60 * MIN)).toBe(MIN);
    expect(bucketMsFor(120 * MIN)).toBe(MIN);
    expect(bucketMsFor(3 * 60 * MIN)).toBe(2 * MIN);
    expect(bucketMsFor(12 * 60 * MIN)).toBe(10 * MIN);
    for (const hours of [0.1, 1, 3, 12, 48]) {
      const span = hours * 60 * MIN;
      expect(Math.ceil(span / bucketMsFor(span))).toBeLessThanOrEqual(MAX_BUCKETS);
    }
  });

  it('says its unit in words', () => {
    expect(bucketWord(MIN)).toBe('minute');
    expect(bucketWord(10 * MIN)).toBe('10 minutes');
    expect(bucketWord(60 * MIN)).toBe('hour');
    expect(bucketWord(120 * MIN)).toBe('2 hours');
  });
});

describe('the density of events', () => {
  it('counts the events of each minute of the hour, and the busiest minute', () => {
    const times = [T0 + 1000, T0 + 2000, T0 + 3000, T0 + MIN + 500, T0 + 59 * MIN + 30_000];
    const result = density(times, HOUR);
    expect(result.bucketMs).toBe(MIN);
    expect(result.counts).toHaveLength(60);
    expect(result.counts[0]).toBe(3);
    expect(result.counts[1]).toBe(1);
    expect(result.counts[59]).toBe(1);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(5);
    expect(result.busiest).toBe(3);
  });

  it('counts an event at the very end in the last stretch, and leaves out one outside the window', () => {
    const result = density([HOUR.to, HOUR.to + 1, HOUR.from - 1, HOUR.from], HOUR);
    expect(result.counts[59]).toBe(1);
    expect(result.counts[0]).toBe(1);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('is empty for no events, with a busiest of zero', () => {
    expect(density([], HOUR)).toMatchObject({ busiest: 0 });
    expect(density([], HOUR).counts.every((n) => n === 0)).toBe(true);
  });

  it('copes with a window of no length', () => {
    const result = density([T0], { from: T0, to: T0 });
    expect(result.counts).toHaveLength(1);
    expect(result.counts[0]).toBe(1);
  });
});

describe('between a pixel and a time', () => {
  it('maps the strip’s width onto the window, and keeps a pixel outside it inside', () => {
    expect(timeAtX(0, 1000, HOUR)).toBe(HOUR.from);
    expect(timeAtX(500, 1000, HOUR)).toBe(HOUR.from + 30 * MIN);
    expect(timeAtX(1000, 1000, HOUR)).toBe(HOUR.to);
    expect(timeAtX(-40, 1000, HOUR)).toBe(HOUR.from);
    expect(timeAtX(4000, 1000, HOUR)).toBe(HOUR.to);
    expect(timeAtX(10, 0, HOUR)).toBe(HOUR.from);
  });

  it('is the inverse, and puts a time outside the window at an end', () => {
    expect(xAtTime(HOUR.from + 15 * MIN, 1000, HOUR)).toBe(250);
    expect(xAtTime(HOUR.from - MIN, 1000, HOUR)).toBe(0);
    expect(xAtTime(HOUR.to + MIN, 1000, HOUR)).toBe(1000);
    expect(xAtTime(T0, 1000, { from: T0, to: T0 })).toBe(0);
  });
});

describe('moving a handle', () => {
  const whole = { ...HOUR };

  it('moves the left handle inward, and the right one', () => {
    expect(moveHandle(HOUR, whole, 'from', T0 + 10 * MIN)).toEqual({
      from: T0 + 10 * MIN,
      to: HOUR.to,
    });
    expect(moveHandle(HOUR, whole, 'to', T0 + 50 * MIN)).toEqual({
      from: HOUR.from,
      to: T0 + 50 * MIN,
    });
  });

  it('keeps a handle inside the window: the strip cannot widen the range', () => {
    expect(moveHandle(HOUR, whole, 'from', T0 - 5 * MIN).from).toBe(HOUR.from);
    expect(moveHandle(HOUR, whole, 'to', HOUR.to + 5 * MIN).to).toBe(HOUR.to);
  });

  it('never lets the handles cross or come closer than a minute', () => {
    const narrowed = { from: T0 + 10 * MIN, to: T0 + 20 * MIN };
    expect(moveHandle(HOUR, narrowed, 'from', T0 + 40 * MIN).from).toBe(narrowed.to - MIN_SPAN_MS);
    expect(moveHandle(HOUR, narrowed, 'to', T0 + MIN).to).toBe(narrowed.from + MIN_SPAN_MS);
  });

  it('does not move at all in a window that is already as narrow as a minute', () => {
    const tiny = { from: T0, to: T0 + MIN };
    expect(moveHandle(tiny, tiny, 'from', T0 + 30_000)).toEqual({ from: T0, to: T0 + MIN });
  });

  it('cannot narrow a window that is already shorter than a minute', () => {
    const short = { from: T0, to: T0 + 20_000 };
    expect(moveHandle(short, short, 'from', T0 + 10_000)).toEqual({ from: T0, to: T0 + 20_000 });
    expect(moveHandle(short, short, 'to', T0 + 10_000)).toEqual({ from: T0, to: T0 + 20_000 });
  });
});

describe('the keys of a handle', () => {
  it('step by a minute, by ten with Shift, and Home and End go to the ends', () => {
    expect(handleKey('ArrowRight', false)).toBe(MIN);
    expect(handleKey('ArrowLeft', false)).toBe(-MIN);
    expect(handleKey('ArrowUp', false)).toBe(MIN);
    expect(handleKey('ArrowDown', true)).toBe(-10 * MIN);
    expect(handleKey('ArrowRight', true)).toBe(10 * MIN);
    expect(handleKey('Home', false)).toBe('start');
    expect(handleKey('End', false)).toBe('end');
    expect(handleKey('Tab', false)).toBeNull();
    expect(handleKey('a', false)).toBeNull();
  });

  it('move the left handle later by the step, and not before the window', () => {
    const whole = { ...HOUR };
    expect(keyMoveHandle(HOUR, whole, 'from', MIN)).toEqual({ from: T0 + MIN, to: HOUR.to });
    expect(keyMoveHandle(HOUR, whole, 'from', -MIN)).toEqual(whole);
    expect(keyMoveHandle(HOUR, whole, 'to', -10 * MIN)).toEqual({
      from: HOUR.from,
      to: HOUR.to - 10 * MIN,
    });
  });

  it('send a handle to an end of the window, stopped by the other handle', () => {
    const narrowed = { from: T0 + 10 * MIN, to: T0 + 20 * MIN };
    expect(keyMoveHandle(HOUR, narrowed, 'from', 'start').from).toBe(HOUR.from);
    expect(keyMoveHandle(HOUR, narrowed, 'from', 'end').from).toBe(narrowed.to - MIN);
    expect(keyMoveHandle(HOUR, narrowed, 'to', 'end').to).toBe(HOUR.to);
    expect(keyMoveHandle(HOUR, narrowed, 'to', 'start').to).toBe(narrowed.from + MIN);
  });
});

describe('the axis', () => {
  it('has five times at even places from the start to the end', () => {
    const axis = axisTimes(HOUR);
    expect(axis.map((a) => a.at)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(axis.map((a) => a.time)).toEqual([0, 15, 30, 45, 60].map((m) => T0 + m * MIN));
    expect(axisTimes(HOUR, 1)).toEqual([{ time: T0, at: 0 }]);
  });
});

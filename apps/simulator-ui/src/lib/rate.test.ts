import { describe, expect, it } from 'vitest';
import { RateCounter } from './rate';

describe('RateCounter', () => {
  it('is zero before anything is counted', () => {
    expect(new RateCounter(5000, 0).perSecond(10_000)).toBe(0);
  });

  it('divides by the time elapsed, at least a second, until a window has passed', () => {
    const rate = new RateCounter(5000, 0);
    for (let t = 0; t < 1000; t += 100) rate.record(t);
    expect(rate.perSecond(1000)).toBe(10);

    const slow = new RateCounter(5000, 0);
    for (const t of [0, 100, 200, 300, 400]) slow.record(t);
    expect(slow.perSecond(2000)).toBe(2.5);
    expect(slow.perSecond(300)).toBe(5); // never divides by less than a second
  });

  it('counts the last window only', () => {
    const rate = new RateCounter(5000, 0);
    for (let t = 0; t < 5000; t += 100) rate.record(t); // 50 messages, one every 100 ms
    expect(rate.perSecond(5000)).toBeCloseTo(9.8, 5); // the one at t = 0 is out of the window
    expect(rate.perSecond(7500)).toBeCloseTo(4.8, 5); // 24 left (2.6 s to 4.9 s), over the 5 s window
    expect(rate.perSecond(20_000)).toBe(0);
  });

  it('keeps counting after it was read', () => {
    const rate = new RateCounter(5000, 0);
    rate.record(100);
    expect(rate.perSecond(1000)).toBe(1);
    rate.record(900);
    expect(rate.perSecond(1000)).toBe(2);
  });

  it('starts again on reset', () => {
    const rate = new RateCounter(5000, 0);
    for (let t = 0; t < 1000; t += 100) rate.record(t);
    rate.reset(10_000);
    expect(rate.perSecond(10_000)).toBe(0);
    rate.record(10_100);
    rate.record(10_200);
    expect(rate.perSecond(11_000)).toBe(2);
  });
});

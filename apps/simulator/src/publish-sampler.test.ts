import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FAULT_LIMITS } from './faults.ts';
import { PUBLISH_BUDGET_PER_S, PublishSampler, SAMPLING_WINDOW_MS } from './publish-sampler.ts';

function setup(options: { budgetPerS?: number; windowMs?: number } = {}) {
  let nowMs = 1_000_000;
  const sampler = new PublishSampler({ ...options, now: () => nowMs });
  return {
    sampler,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe('PublishSampler', () => {
  it('has a budget of one burst chunk, so a 100-device tick is not sampled', () => {
    assert.equal(PUBLISH_BUDGET_PER_S, FAULT_LIMITS.burstChunk);
    const { sampler } = setup();
    for (let i = 0; i < 100; i++) assert.equal(sampler.offer().forward, true);
    assert.equal(sampler.active, false);
    assert.equal(sampler.state().total, 100);
  });

  it('forwards everything under the budget and reports nothing', () => {
    const { sampler, advance } = setup({ budgetPerS: 5 });
    for (let window = 0; window < 3; window++) {
      for (let i = 0; i < 5; i++) {
        const result = sampler.offer();
        assert.equal(result.forward, true);
        assert.equal(result.report, undefined);
      }
      advance(SAMPLING_WINDOW_MS);
    }
    assert.equal(sampler.roll(), undefined);
    assert.equal(sampler.active, false);
  });

  it('skips what is past the budget and counts every message exactly', () => {
    const { sampler } = setup({ budgetPerS: 250 });
    let forwarded = 0;
    for (let i = 0; i < 10_000; i++) if (sampler.offer().forward) forwarded++;
    assert.equal(forwarded, 250);
    assert.deepEqual(sampler.state(), {
      total: 10_000,
      active: true,
      skipped: 9_750,
      budgetPerS: 250,
      windowMs: SAMPLING_WINDOW_MS,
    });
  });

  it('forwards again in the next window and reports the one that closed', () => {
    const { sampler, advance } = setup({ budgetPerS: 2 });
    for (let i = 0; i < 5; i++) sampler.offer();
    advance(SAMPLING_WINDOW_MS);
    const next = sampler.offer();
    assert.equal(next.forward, true);
    assert.deepEqual(next.report, {
      total: 5,
      skipped: 3,
      forwarded: 2,
      windowMs: SAMPLING_WINDOW_MS,
      budgetPerS: 2,
      active: true,
    });
    assert.equal(sampler.state().skipped, 0);
  });

  it('reports the last window from roll when the traffic stops', () => {
    const { sampler, advance } = setup({ budgetPerS: 1 });
    for (let i = 0; i < 4; i++) sampler.offer();
    assert.equal(sampler.roll(), undefined); // the window is not over
    advance(SAMPLING_WINDOW_MS);
    const report = sampler.roll();
    assert.equal(report?.active, true);
    assert.equal(report?.skipped, 3);
    assert.equal(report?.total, 4);
    assert.equal(sampler.active, true); // the closing report is still owed
  });

  it('closes a stretch of sampling with one report of active false, then goes quiet', () => {
    const { sampler, advance } = setup({ budgetPerS: 1 });
    sampler.offer();
    sampler.offer();
    advance(SAMPLING_WINDOW_MS);
    assert.equal(sampler.roll()?.active, true);
    advance(SAMPLING_WINDOW_MS);
    const closing = sampler.roll();
    assert.equal(closing?.active, false);
    assert.equal(closing?.skipped, 0);
    assert.equal(closing?.total, 2);
    assert.equal(sampler.active, false);
    advance(SAMPLING_WINDOW_MS);
    assert.equal(sampler.roll(), undefined);
  });

  it('is active again when sampling starts again after a closing report', () => {
    const { sampler, advance } = setup({ budgetPerS: 1 });
    sampler.offer();
    sampler.offer();
    advance(SAMPLING_WINDOW_MS);
    sampler.roll();
    advance(SAMPLING_WINDOW_MS);
    sampler.roll();
    assert.equal(sampler.active, false);
    sampler.offer();
    sampler.offer();
    assert.equal(sampler.active, true);
  });

  it('keeps counting through windows that nobody rolled', () => {
    const { sampler, advance } = setup({ budgetPerS: 1 });
    sampler.offer();
    sampler.offer();
    advance(10 * SAMPLING_WINDOW_MS);
    const result = sampler.offer();
    assert.equal(result.forward, true);
    assert.equal(result.report?.total, 2);
    assert.equal(sampler.state().total, 3);
  });

  it('refuses a budget or a window that cannot work', () => {
    assert.throws(() => new PublishSampler({ budgetPerS: 0, now: Date.now }), RangeError);
    assert.throws(() => new PublishSampler({ budgetPerS: 1.5, now: Date.now }), RangeError);
    assert.throws(() => new PublishSampler({ windowMs: 0, now: Date.now }), RangeError);
    assert.throws(() => new PublishSampler({ windowMs: Number.NaN, now: Date.now }), RangeError);
  });
});

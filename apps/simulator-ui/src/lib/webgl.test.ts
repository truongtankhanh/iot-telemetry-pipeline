import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_GRACE_MS, watchContextLoss, webgl2Available } from './webgl';

describe('webgl2Available', () => {
  it('is true when a WebGL 2 context can be made, and gives the context back at once', () => {
    const loseContext = vi.fn();
    const getContext = vi.fn(() => ({ getExtension: () => ({ loseContext }) }));
    expect(webgl2Available(() => ({ getContext }))).toBe(true);
    expect(getContext).toHaveBeenCalledWith('webgl2');
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('is true for a context that cannot be released: it works, there is just nothing to give back', () => {
    expect(webgl2Available(() => ({ getContext: () => ({ getExtension: () => null }) }))).toBe(
      true,
    );
  });

  it('is false when the browser answers no context', () => {
    expect(webgl2Available(() => ({ getContext: () => null }))).toBe(false);
  });

  it('is false, and does not throw, when asking throws or there is no canvas', () => {
    expect(
      webgl2Available(() => ({
        getContext: () => {
          throw new Error('blocked');
        },
      })),
    ).toBe(false);
    expect(
      webgl2Available(() => {
        throw new Error('no canvas');
      }),
    ).toBe(false);
  });
});

describe('watchContextLoss', () => {
  afterEach(() => vi.useRealTimers());

  const lose = (target: EventTarget) => {
    const event = new Event('webglcontextlost', { cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const restore = (target: EventTarget) => target.dispatchEvent(new Event('webglcontextrestored'));

  it('prevents the default of a loss, so the browser may restore the context', () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    watchContextLoss(target, vi.fn());
    expect(lose(target).defaultPrevented).toBe(true);
  });

  it('falls back once, after 5 seconds, when the context does not come back', () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const onFallback = vi.fn();
    watchContextLoss(target, onFallback);
    lose(target);
    vi.advanceTimersByTime(CONTEXT_GRACE_MS - 1);
    expect(onFallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    lose(target);
    vi.advanceTimersByTime(CONTEXT_GRACE_MS * 2);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when the context is restored inside the grace period', () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const onFallback = vi.fn();
    watchContextLoss(target, onFallback);
    lose(target);
    vi.advanceTimersByTime(3000);
    restore(target);
    vi.advanceTimersByTime(CONTEXT_GRACE_MS * 2);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('starts the wait again for a second loss after a restore, and does not stack two waits', () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const onFallback = vi.fn();
    watchContextLoss(target, onFallback);
    lose(target);
    lose(target);
    restore(target);
    lose(target);
    vi.advanceTimersByTime(CONTEXT_GRACE_MS);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('takes the grace period from its options', () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const onFallback = vi.fn();
    watchContextLoss(target, onFallback, { graceMs: 100 });
    lose(target);
    vi.advanceTimersByTime(100);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('stops watching: no timer is left and a later loss is not heard', () => {
    vi.useFakeTimers();
    const target = new EventTarget();
    const onFallback = vi.fn();
    const stop = watchContextLoss(target, onFallback);
    lose(target);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    lose(target);
    vi.advanceTimersByTime(CONTEXT_GRACE_MS * 2);
    expect(onFallback).not.toHaveBeenCalled();
  });
});

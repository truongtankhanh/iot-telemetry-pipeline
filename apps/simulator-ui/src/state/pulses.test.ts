import { describe, expect, it, vi } from 'vitest';
import { DotLimiter, MAX_DOTS_PER_EDGE, PulseBus } from './pulses';

describe('PulseBus', () => {
  it('tells the listeners of a device, and only theirs', () => {
    const bus = new PulseBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(['dc-env-01'], a);
    bus.subscribe(['dc-env-02'], b);
    bus.emit('dc-env-01', 1000);
    expect(a).toHaveBeenCalledExactlyOnceWith('dc-env-01', 1000);
    expect(b).not.toHaveBeenCalled();
  });

  it('lets one listener hear several devices, which is how a zone edge listens', () => {
    const bus = new PulseBus();
    const listener = vi.fn();
    bus.subscribe(['a', 'b'], listener);
    bus.emit('a', 1);
    bus.emit('b', 2);
    bus.emit('c', 3);
    expect(listener.mock.calls).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('hears a device named twice once', () => {
    const bus = new PulseBus();
    const listener = vi.fn();
    bus.subscribe(['a', 'a'], listener);
    bus.emit('a', 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops when the listener unsubscribes, and only that listener', () => {
    const bus = new PulseBus();
    const kept = vi.fn();
    const gone = vi.fn();
    bus.subscribe(['a'], kept);
    const stop = bus.subscribe(['a'], gone);
    stop();
    stop(); // safe twice
    bus.emit('a', 1);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(gone).not.toHaveBeenCalled();
  });

  it('says nothing for a device nobody listens to', () => {
    expect(() => new PulseBus().emit('nobody', 1)).not.toThrow();
  });

  it('forgets its listeners on dispose, and can be used again', () => {
    const bus = new PulseBus();
    const old = vi.fn();
    bus.subscribe(['a'], old);
    bus.dispose();
    bus.emit('a', 1);
    expect(old).not.toHaveBeenCalled();

    const fresh = vi.fn();
    bus.subscribe(['a'], fresh);
    bus.emit('a', 2);
    expect(fresh).toHaveBeenCalledExactlyOnceWith('a', 2);
  });

  it('logs a listener that throws, and does not stop the others', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const bus = new PulseBus();
      const after = vi.fn();
      bus.subscribe(['a'], () => {
        throw new Error('boom');
      });
      bus.subscribe(['a'], after);
      expect(() => bus.emit('a', 1)).not.toThrow();
      expect(after).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0]?.[0])).toMatch(/pulse listener for a failed/);
    } finally {
      logged.mockRestore();
    }
  });
});

describe('DotLimiter', () => {
  it('admits up to 4 dots and refuses the fifth, as the brief says', () => {
    const limiter = new DotLimiter();
    expect(MAX_DOTS_PER_EDGE).toBe(4);
    const admitted = Array.from({ length: 6 }, () => limiter.tryStart());
    expect(admitted).toEqual([true, true, true, true, false, false]);
    expect(limiter.count).toBe(4);
  });

  it('admits another when a dot arrives', () => {
    const limiter = new DotLimiter(2);
    limiter.tryStart();
    limiter.tryStart();
    expect(limiter.tryStart()).toBe(false);
    limiter.finish();
    expect(limiter.tryStart()).toBe(true);
    expect(limiter.count).toBe(2);
  });

  it('drops the refused dot instead of queueing it', () => {
    const limiter = new DotLimiter(1);
    limiter.tryStart();
    limiter.tryStart(); // refused
    limiter.finish();
    expect(limiter.count).toBe(0);
    expect(limiter.tryStart()).toBe(true);
  });

  it('never counts below zero', () => {
    const limiter = new DotLimiter();
    limiter.finish();
    limiter.finish();
    expect(limiter.count).toBe(0);
    expect(limiter.tryStart()).toBe(true);
  });

  it('forgets every dot on reset', () => {
    const limiter = new DotLimiter();
    for (let i = 0; i < 4; i++) limiter.tryStart();
    limiter.reset();
    expect(limiter.count).toBe(0);
  });

  it('can be given another cap', () => {
    const limiter = new DotLimiter(1);
    expect(limiter.tryStart()).toBe(true);
    expect(limiter.tryStart()).toBe(false);
  });
});

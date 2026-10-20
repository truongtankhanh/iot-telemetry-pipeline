/**
 * The engine's only view of time. Production uses `systemClock`; tests and the simulated-clock mode
 * use a `ManualClock`, whose time moves only when it is told to.
 */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Calls `fn` once after `delayMs`. Returns a function that cancels it. */
  setTimer(delayMs: number, fn: () => void | Promise<void>): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer(delayMs, fn) {
    const handle = setTimeout(fn, delayMs);
    return () => clearTimeout(handle);
  },
};

interface Timer {
  id: number;
  dueMs: number;
  fn: () => void | Promise<void>;
}

/**
 * A clock that stands still until `advance` is called. `advance` runs the timers that fall inside
 * the window one at a time, in time order (insertion order for equal times), and waits for each
 * callback to finish, so a test sees every effect of a tick before the next one starts.
 */
export class ManualClock implements Clock {
  private currentMs: number;
  private timers: Timer[] = [];
  private nextId = 1;

  constructor(startMs: number) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  setTimer(delayMs: number, fn: () => void | Promise<void>): () => void {
    const timer: Timer = { id: this.nextId++, dueMs: this.currentMs + Math.max(0, delayMs), fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  async advance(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`Cannot advance the clock by ${ms} ms`);
    }
    const target = this.currentMs + ms;
    for (;;) {
      const next = this.timers
        .filter((t) => t.dueMs <= target)
        .sort((a, b) => a.dueMs - b.dueMs || a.id - b.id)[0];
      if (!next) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.currentMs = Math.max(this.currentMs, next.dueMs);
      await next.fn();
    }
    this.currentMs = target;
  }
}

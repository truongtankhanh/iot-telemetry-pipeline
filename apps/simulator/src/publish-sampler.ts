/**
 * Messages the stream forwards in one window before it starts to sample. It is the size of a burst chunk
 * (`FAULT_LIMITS.burstChunk`), not a rate the page could never read: the engine publishes every device that is
 * due in the same tick, so the 100-device registry offers 100 messages within a few milliseconds every 2 s, and a
 * smaller budget would have the page "sampling" on a normal demo fleet.
 */
export const PUBLISH_BUDGET_PER_S = 250;
export const SAMPLING_WINDOW_MS = 1000;

export interface SamplerOptions {
  /** Messages forwarded per window before the rest are skipped. */
  budgetPerS?: number;
  windowMs?: number;
  /** Wall clock in milliseconds. Not the engine's clock, which may be simulated. */
  now: () => number;
}

/** What one closed window did. `total` is the count of every message so far, forwarded or not. */
export interface SamplingReport {
  total: number;
  skipped: number;
  forwarded: number;
  windowMs: number;
  budgetPerS: number;
  /** True when the window skipped something; the one report with false closes a stretch of sampling. */
  active: boolean;
}

export interface SamplingState {
  total: number;
  /** Sampling is going on: the open window has skipped a message, or the last report said so and has not been closed. */
  active: boolean;
  /** Skipped in the open window. */
  skipped: number;
  budgetPerS: number;
  windowMs: number;
}

/**
 * Decides which published messages the stream forwards, so that the tail stays responsive at the rate of a burst or
 * a benchmark: the first `budgetPerS` of each window go through, the rest are counted and dropped, and a report per
 * window carries the counts so the page can say it is sampling and keep its message rate right
 * (`forwarded + skipped` over `windowMs`).
 *
 * Pure: no timer and no I/O. A window is closed by the next `offer`, or by `roll`, which the caller calls on a timer
 * while sampling is active so that the last window is reported when the traffic stops.
 */
export class PublishSampler {
  private readonly budgetPerS: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private total = 0;
  private forwarded = 0;
  private skipped = 0;
  private windowStart: number;
  /** The last report said `active: true`, so the next quiet window owes a closing one. */
  private reportedActive = false;

  constructor(options: SamplerOptions) {
    this.budgetPerS = options.budgetPerS ?? PUBLISH_BUDGET_PER_S;
    this.windowMs = options.windowMs ?? SAMPLING_WINDOW_MS;
    if (!Number.isInteger(this.budgetPerS) || this.budgetPerS < 1) {
      throw new RangeError(
        `The sampling budget is a whole number of at least 1, got ${this.budgetPerS}`,
      );
    }
    if (!Number.isFinite(this.windowMs) || this.windowMs <= 0) {
      throw new RangeError(`The sampling window is a positive number of ms, got ${this.windowMs}`);
    }
    this.now = options.now;
    this.windowStart = this.now();
  }

  /**
   * Counts one message and says whether to forward it. `report` is set when this call closed a window that is worth
   * reporting (see `roll`); it describes the window before this message.
   */
  offer(): { forward: boolean; report?: SamplingReport } {
    const report = this.roll();
    this.total++;
    const forward = this.forwarded < this.budgetPerS;
    if (forward) this.forwarded++;
    else this.skipped++;
    return report ? { forward, report } : { forward };
  }

  /**
   * Closes the window if it is over. Returns a report when it skipped something, or, once, when it is the first quiet
   * window after sampling; `undefined` for a window that is not over and for a quiet one with nothing owed.
   */
  roll(): SamplingReport | undefined {
    if (this.now() - this.windowStart < this.windowMs) return undefined;
    const report: SamplingReport = {
      total: this.total,
      skipped: this.skipped,
      forwarded: this.forwarded,
      windowMs: this.windowMs,
      budgetPerS: this.budgetPerS,
      active: this.skipped > 0,
    };
    this.windowStart = this.now();
    this.forwarded = 0;
    this.skipped = 0;
    if (report.active) {
      this.reportedActive = true;
      return report;
    }
    if (this.reportedActive) {
      this.reportedActive = false;
      return report;
    }
    return undefined;
  }

  /** True while the timer that calls `roll` is needed. */
  get active(): boolean {
    return this.skipped > 0 || this.reportedActive;
  }

  state(): SamplingState {
    return {
      total: this.total,
      active: this.active,
      skipped: this.skipped,
      budgetPerS: this.budgetPerS,
      windowMs: this.windowMs,
    };
  }
}

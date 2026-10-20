/**
 * Messages per second over a sliding window, from the times messages were seen. The UI counts the
 * `published` events of the stream instead of reading the engine's counter (which only arrives with
 * a snapshot) or dividing by the configured interval (which lies while devices are paused).
 *
 * Until a whole window has passed the rate is divided by the time elapsed (at least one second), so a
 * page that has been open for two seconds is not shown a rate five times too low.
 */
export class RateCounter {
  private stamps: number[] = [];
  private startedAt: number;
  private readonly windowMs: number;

  constructor(windowMs = 5000, startedAt: number = Date.now()) {
    this.windowMs = windowMs;
    this.startedAt = startedAt;
  }

  record(at: number): void {
    this.stamps.push(at);
  }

  perSecond(now: number): number {
    const from = now - this.windowMs;
    const first = this.stamps.findIndex((t) => t > from);
    this.stamps = first === -1 ? [] : this.stamps.slice(first);
    const spanMs = Math.min(this.windowMs, Math.max(1000, now - this.startedAt));
    return this.stamps.length / (spanMs / 1000);
  }

  /** Forgets what was counted and starts the ramp-up again (after the link was lost). */
  reset(now: number): void {
    this.stamps = [];
    this.startedAt = now;
  }
}

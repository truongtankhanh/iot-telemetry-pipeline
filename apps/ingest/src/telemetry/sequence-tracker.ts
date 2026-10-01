/**
 * Counts missing messages per device from their sequence numbers (ADR-0002).
 *
 * Returns how many messages were skipped between the last seen `seq` and this one. A sequence that
 * goes backwards is either a redelivery (small step back — ignored) or a device restart (large
 * step back or back to 0 — treated as a new run).
 */
export class SequenceTracker {
  private readonly last = new Map<string, number>();

  constructor(private readonly restartThreshold = 1000) {}

  observe(deviceId: string, seq: number): number {
    const previous = this.last.get(deviceId);
    if (previous === undefined) {
      this.last.set(deviceId, seq);
      return 0;
    }
    if (seq > previous) {
      this.last.set(deviceId, seq);
      return seq - previous - 1;
    }
    if (seq === 0 || previous - seq > this.restartThreshold) {
      this.last.set(deviceId, seq); // device restarted its counter
    }
    return 0;
  }
}

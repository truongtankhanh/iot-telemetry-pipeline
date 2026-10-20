/** Told when a device published: the id and when (ms since the epoch, this window's clock). */
export type PulseListener = (deviceId: string, at: number) => void;

/**
 * "A message left a device", as an event. It exists for the dots that travel the topology's edges: they must move when
 * the engine published, and a message arrives about fifteen times a second at thirty devices, so nothing may render per
 * message. Like `HistoryStore` this lives outside React and outside Zustand; an edge subscribes to the devices behind
 * it and animates by hand.
 *
 * Only the stream's `published` messages feed it. A snapshot's publish log is the past and is not replayed as dots.
 */
export class PulseBus {
  private readonly listeners = new Map<string, Set<PulseListener>>();
  private disposed = false;

  /** Calls the listeners of a device. One that throws is logged and does not stop the others, nor the stream that called. */
  emit(deviceId: string, at: number): void {
    if (this.disposed) return;
    for (const listener of this.listeners.get(deviceId) ?? []) {
      try {
        listener(deviceId, at);
      } catch (error) {
        // Logged, not rethrown: a broken dot must not stop the stream's other work or the other edges' dots.
        console.error(`pulse listener for ${deviceId} failed`, error);
      }
    }
  }

  /** Listens to some devices; returns the function that stops. A device named twice is listened to once. */
  subscribe(deviceIds: readonly string[], listener: PulseListener): () => void {
    const ids = [...new Set(deviceIds)];
    for (const id of ids) {
      const set = this.listeners.get(id) ?? new Set<PulseListener>();
      set.add(listener);
      this.listeners.set(id, set);
    }
    return () => {
      for (const id of ids) {
        const set = this.listeners.get(id);
        set?.delete(listener);
        if (set?.size === 0) this.listeners.delete(id);
      }
    };
  }

  /** Forgets every listener; later `emit`s do nothing. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

/** Dots alive at once on one edge (the brief: at most 4). */
export const MAX_DOTS_PER_EDGE = 4;

/**
 * Counts the dots alive on one edge and refuses a fifth. A dot that is refused is dropped, not queued: the edge is
 * already showing movement, and a backlog would keep dots running after the messages stopped.
 */
export class DotLimiter {
  private alive = 0;
  private readonly max: number;

  constructor(max: number = MAX_DOTS_PER_EDGE) {
    this.max = max;
  }

  /** True when a dot may start; it must be matched by one `finish`. */
  tryStart(): boolean {
    if (this.alive >= this.max) return false;
    this.alive += 1;
    return true;
  }

  /** A dot arrived (or was cancelled). Extra calls do not take the count below zero. */
  finish(): void {
    this.alive = Math.max(0, this.alive - 1);
  }

  get count(): number {
    return this.alive;
  }

  /** Drops every dot at once (the edge went dark, or the user asked for less motion). */
  reset(): void {
    this.alive = 0;
  }
}

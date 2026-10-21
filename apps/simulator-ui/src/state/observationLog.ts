import type { ObservationEvent } from '../api/types';

/** How many events the simulator keeps (`OBSERVATION_CAPACITY` in `apps/simulator/src/observation-store.ts`); the log holds no more. */
export const OBSERVATION_CAPACITY = 5000;

export interface ObservationLogOptions {
  capacity?: number;
  /** Listeners hear about a live event at most this often. A seed, a clear and the progress of a read are told at once. */
  notifyEveryMs?: number;
}

/** What a reader gets: the same object until the next notification, so `useSyncExternalStore` sees no change as no change. */
export interface ObservationLogSnapshot {
  /** Newest first. Do not change it. */
  readonly events: readonly ObservationEvent[];
  /** The id of the newest event, `0` when there is none. */
  readonly newestId: number;
  /** While the log is being read from the simulator: how many events have arrived so far. `null` when it is not being read. */
  readonly loading: number | null;
}

const EMPTY: ObservationLogSnapshot = { events: [], newestId: 0, loading: null };

/**
 * The simulator's observations (what happened to the engine, the scenarios, the alerts and their delivery), as far
 * back as the simulator keeps them: the last 5,000. It is built in the browser from the paged read of
 * `/api/observations` when a connection opens and from the stream's `observation` events after that; an event is
 * identified by its `id`, so the same event arriving twice (the read and the stream overlap) is kept once.
 *
 * It lives outside React and outside the Zustand store on purpose, as `HistoryStore` does: thousands of events are
 * not state a render should diff, and the timeline wants one sorted array it can filter and page. A component
 * subscribes and is told at most once per `notifyEveryMs`.
 */
export class ObservationLog {
  private readonly capacity: number;
  private readonly notifyEveryMs: number;
  /** Oldest first, by `id`; the order the events were recorded in. */
  private events: ObservationEvent[] = [];
  private ids = new Set<number>();
  private progress: number | null = null;
  private current: ObservationLogSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ObservationLogOptions = {}) {
    this.capacity = options.capacity ?? OBSERVATION_CAPACITY;
    this.notifyEveryMs = options.notifyEveryMs ?? 1000;
  }

  /** The id of the newest event, `0` when there is none. Not throttled: the stream compares it with the simulator's. */
  newestId(): number {
    return this.events.at(-1)?.id ?? 0;
  }

  /** Records an event that arrived live. A duplicate is ignored. Listeners hear about it within `notifyEveryMs`. */
  record(event: ObservationEvent): void {
    if (!this.add(event)) return;
    this.trim();
    this.scheduleNotify();
  }

  /**
   * Adds the events of a read of the simulator (any order). What the log already holds stays unless the read has it
   * too: an event recorded live while the read was on its way is newer than everything the read returned, and a
   * duplicate is ignored by `id`. Listeners are told at once.
   */
  seed(events: readonly ObservationEvent[]): void {
    // Appended and sorted once: a read arrives newest first, and placing each event by hand would be quadratic.
    for (const event of events) {
      if (this.ids.has(event.id)) continue;
      this.ids.add(event.id);
      this.events.push(event);
    }
    this.events.sort((a, b) => a.id - b.id);
    this.trim();
    this.flush();
  }

  /** Forgets everything: the simulator started again, and its ids began again at 1. Listeners are told at once. */
  clear(): void {
    this.events = [];
    this.ids = new Set();
    this.progress = null;
    this.flush();
  }

  /** `n` events have arrived of a read that is going on, or `null` when no read is. Listeners are told at once. */
  setLoading(n: number | null): void {
    if (this.progress === n) return;
    this.progress = n;
    this.flush();
  }

  /** The log as of the last notification, as one object until the next. */
  snapshot(): ObservationLogSnapshot {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops the pending notification; the data stays. */
  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private add(event: ObservationEvent): boolean {
    if (this.ids.has(event.id)) return false;
    this.ids.add(event.id);
    // Almost always the newest; a late one is placed where its id says.
    let at = this.events.length;
    while (at > 0 && (this.events[at - 1] as ObservationEvent).id > event.id) at -= 1;
    this.events.splice(at, 0, event);
    return true;
  }

  private trim(): void {
    const drop = this.events.length - this.capacity;
    if (drop <= 0) return;
    for (const event of this.events.splice(0, drop)) this.ids.delete(event.id);
  }

  private scheduleNotify(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.notifyEveryMs);
  }

  private flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    // Rebuilt here and nowhere else: a reader that renders between two notifications must not see a new array.
    this.current = {
      events: [...this.events].reverse(),
      newestId: this.newestId(),
      loading: this.progress,
    };
    for (const listener of [...this.listeners]) listener();
  }
}

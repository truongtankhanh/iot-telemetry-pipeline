/** A fixed-size buffer that forgets its oldest item when it is full. */
export class RingBuffer<T> {
  private readonly slots: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`A ring buffer needs a capacity of at least 1, got ${capacity}`);
    }
    this.slots = new Array<T | undefined>(capacity).fill(undefined);
  }

  get capacity(): number {
    return this.slots.length;
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    if (this.count < this.slots.length) {
      this.slots[(this.start + this.count) % this.slots.length] = item;
      this.count++;
    } else {
      this.slots[this.start] = item;
      this.start = (this.start + 1) % this.slots.length;
    }
  }

  /** Oldest first. */
  toArray(): T[] {
    const items: T[] = [];
    for (let i = 0; i < this.count; i++) {
      items.push(this.slots[(this.start + i) % this.slots.length] as T);
    }
    return items;
  }
}

export type ObservationKind =
  | 'engine-state'
  | 'tick-error'
  | 'scenario-run'
  | 'scenario-stop'
  | 'alert-opened'
  | 'alert-cleared'
  | 'delivery'
  | 'incident'
  | 'dependency'
  | 'benchmark';

/** What happened, before the store gives it an id and a time. */
export interface ObservationDraft {
  kind: ObservationKind;
  data: Record<string, unknown>;
}

export interface ObservationEvent extends ObservationDraft {
  /** Strictly increasing from 1 for the life of the store, whatever has been evicted. */
  id: number;
  /** When Studio saw it (wall time, ISO 8601), not when it happened: ingest sends no such time. */
  at: string;
}

export const OBSERVATION_CAPACITY = 5000;
export const PAGE_DEFAULT = 100;
export const PAGE_MAX = 500;

export interface ObservationPage {
  /** Newest first. */
  events: ObservationEvent[];
  /** The `before` for the next page: set only when older events remain. */
  next: number | undefined;
}

/**
 * The last 5,000 things Studio saw during the session, in memory: state changes, alerts, deliveries,
 * incidents and dependency changes. Published messages are not kept here (the publish log has
 * them), or a busy fleet would push the history the timeline exists to show out in minutes.
 */
export class ObservationStore {
  private readonly ring: RingBuffer<ObservationEvent>;
  private lastId = 0;

  constructor(capacity: number = OBSERVATION_CAPACITY) {
    this.ring = new RingBuffer<ObservationEvent>(capacity);
  }

  append(draft: ObservationDraft, at: string): ObservationEvent {
    const event: ObservationEvent = { id: ++this.lastId, at, kind: draft.kind, data: draft.data };
    this.ring.push(event);
    return event;
  }

  /** The id of the newest event, or 0 when there is none yet. */
  latestId(): number {
    return this.lastId;
  }

  /** Every kept event of one kind, oldest first. For the rare kinds (a scenario run); not a way to page the store. */
  byKind(kind: ObservationKind): ObservationEvent[] {
    return this.ring.toArray().filter((event) => event.kind === kind);
  }

  /** `before` is exclusive; `limit` is clamped to 1 to 500 and defaults to 100. */
  page(options: { before?: number | undefined; limit?: number | undefined } = {}): ObservationPage {
    const limit = Number.isFinite(options.limit)
      ? Math.min(PAGE_MAX, Math.max(1, Math.trunc(options.limit as number)))
      : PAGE_DEFAULT;
    const before = options.before ?? Infinity;
    const older = this.ring.toArray().filter((e) => e.id < before);
    const events = older.slice(-limit).reverse();
    const oldestReturned = events.at(-1);
    const remaining = oldestReturned ? older.length - events.length : 0;
    return { events, next: remaining > 0 && oldestReturned ? oldestReturned.id : undefined };
  }
}

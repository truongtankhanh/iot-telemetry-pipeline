import type { PublishedMessage, SamplingReport, Snapshot } from '../api/types';
import { type MessageRow, toRow } from '../lib/messageRows';

/** How many messages the simulator keeps in its publish log (`PUBLISH_LOG_SIZE`); the log holds no more. */
export const MESSAGE_CAPACITY = 200;

/** A table people watch should move in steps they do not notice, so this is shorter than the other stores' second. */
export const MESSAGE_NOTIFY_MS = 250;

export interface MessageLogOptions {
  capacity?: number;
  /** Listeners hear about a live message at most this often. A seed, a clear and a sampling report are told at once. */
  notifyEveryMs?: number;
}

/** The stream is skipping messages: how many in the last window, and the budget it forwards. */
export interface SamplingNotice {
  skipped: number;
  budgetPerS: number;
  windowMs: number;
}

/** What a reader gets: the same object until the next notification, so `useSyncExternalStore` sees no change as no change. */
export interface MessageLogSnapshot {
  /** Newest first, without what Clear hid. Do not change it. */
  readonly rows: readonly MessageRow[];
  /** Every message published so far, forwarded or not (the rows are what was forwarded and kept). */
  readonly total: number;
  /** Set while the simulator is sampling; `null` otherwise. */
  readonly sampling: SamplingNotice | null;
  /** The id of the newest message kept, `0` when there is none. */
  readonly newestId: number;
  /** Clear hid every message up to this id; `0` when nothing was cleared. */
  readonly clearedBefore: number;
}

const EMPTY: MessageLogSnapshot = {
  rows: [],
  total: 0,
  sampling: null,
  newestId: 0,
  clearedBefore: 0,
};

/** What a snapshot of the stream says about the total and the sampling (`publishTotal` and `sampling`). */
export interface SeedInfo {
  total?: number | undefined;
  sampling?: Snapshot['sampling'] | undefined;
}

/**
 * The last 200 messages the simulator forwarded, as rows for the Event stream, and the numbers beside them: the exact
 * total and whether the simulator is sampling. It is built in the browser from the first message of the stream (the
 * publish log) and from `published` and `sampling` events after that; a message is identified by its `id`.
 *
 * It lives outside React and outside the Zustand store on purpose, as `HistoryStore` and `ObservationLog` do: a message
 * arrives hundreds of times a second at the benchmark's rate and nothing may render per message. A component subscribes
 * and is told at most once per `notifyEveryMs`.
 *
 * **Clear** is the page's own cut-off, because the simulator's log is shared (it seeds every reconnect and the Fleet):
 * it hides what is there now. It survives a reconnect (the next snapshot holds the same messages) and is dropped when the
 * simulator is seen to have started again (its ids begin at 1, so the newest one is lower than one already seen).
 */
export class MessageLog {
  private readonly capacity: number;
  private readonly notifyEveryMs: number;
  /** Oldest first, by `id`. */
  private items: MessageRow[] = [];
  private ids = new Set<number>();
  private total = 0;
  private sampling: SamplingNotice | null = null;
  /** The highest id seen since the simulator last started: what Clear hides up to. */
  private highest = 0;
  private clearedBefore = 0;
  private current: MessageLogSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: MessageLogOptions = {}) {
    this.capacity = options.capacity ?? MESSAGE_CAPACITY;
    this.notifyEveryMs = options.notifyEveryMs ?? MESSAGE_NOTIFY_MS;
  }

  /**
   * Records a message that arrived live and counts it. A duplicate `id` is ignored, and so is a message without one
   * (it could not be told from another or named in a republish). Listeners hear about it within `notifyEveryMs`.
   */
  record(message: PublishedMessage): void {
    const row = toRow(message);
    if (row === null || this.ids.has(row.id)) return;
    this.add(row);
    this.total += 1;
    this.highest = Math.max(this.highest, row.id);
    this.trim();
    this.scheduleNotify();
  }

  /**
   * Replaces what is held with the messages of a snapshot (any order), as the first message of every connection does, so
   * a reconnect does not double what was here. `total` is the simulator's count; without it the count is what was given.
   * Listeners are told at once.
   */
  seed(messages: readonly PublishedMessage[], info: SeedInfo = {}): void {
    const rows: MessageRow[] = [];
    for (const message of messages) {
      const row = toRow(message);
      if (row !== null) rows.push(row);
    }
    rows.sort((a, b) => a.id - b.id);
    this.items = [];
    this.ids = new Set();
    for (const row of rows) this.add(row);
    this.trim();

    const newest = this.items.at(-1)?.id ?? 0;
    // A lower newest id than one already seen: the simulator started again, and what Clear hid is gone with it.
    if (newest < this.highest) this.clearedBefore = 0;
    this.highest = newest;
    this.total =
      typeof info.total === 'number' && Number.isFinite(info.total) ? info.total : rows.length;
    this.sampling = noticeOf(info.sampling);
    this.flush();
  }

  /**
   * A report of the simulator's sampling: its `total` is exact (every message up to the end of the window it closes, and
   * the messages forwarded in that window have all arrived before it), so it replaces the running count. A report with
   * `active: false` ends the notice. Listeners are told at once.
   */
  applySampling(report: SamplingReport): void {
    if (Number.isFinite(report.total)) this.total = report.total;
    this.sampling = report.active
      ? { skipped: report.skipped, budgetPerS: report.budgetPerS, windowMs: report.windowMs }
      : null;
    this.flush();
  }

  /** Hides every message there is now. The total is not touched. Listeners are told at once. */
  clear(): void {
    this.clearedBefore = this.highest;
    this.flush();
  }

  /**
   * Whether a message is among those kept, whether or not Clear hid it. The simulator's own log holds the same messages, so
   * this is also "the simulator can still send it again". Read at the time of the call, not at the last notification.
   */
  has(id: number): boolean {
    return this.ids.has(id);
  }

  /** The log as of the last notification, as one object until the next. */
  snapshot(): MessageLogSnapshot {
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

  private add(row: MessageRow): void {
    this.ids.add(row.id);
    // Almost always the newest; a late one is placed where its id says.
    let at = this.items.length;
    while (at > 0 && (this.items[at - 1] as MessageRow).id > row.id) at -= 1;
    this.items.splice(at, 0, row);
  }

  private trim(): void {
    const drop = this.items.length - this.capacity;
    if (drop <= 0) return;
    for (const row of this.items.splice(0, drop)) this.ids.delete(row.id);
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
    const shown = this.items.filter((row) => row.id > this.clearedBefore).reverse();
    this.current = {
      rows: shown,
      total: this.total,
      sampling: this.sampling,
      newestId: this.items.at(-1)?.id ?? 0,
      clearedBefore: this.clearedBefore,
    };
    for (const listener of [...this.listeners]) listener();
  }
}

function noticeOf(sampling: Snapshot['sampling'] | undefined): SamplingNotice | null {
  if (!sampling?.active) return null;
  return {
    skipped: sampling.skipped,
    budgetPerS: sampling.budgetPerS,
    windowMs: sampling.windowMs,
  };
}

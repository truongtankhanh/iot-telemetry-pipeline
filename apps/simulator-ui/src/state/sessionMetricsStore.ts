import type { MetricsFeed } from '../api/types';
import { pointOf, type SessionPoint } from '../lib/sessionMetrics';

/** About thirty minutes of one point a second: a long demo does not grow the browser without bound. */
export const SESSION_CAPACITY = 1800;

/** What a reader gets: the same object until the next point. */
export interface SessionMetricsSnapshot {
  /** Oldest first. Do not change it. */
  readonly points: readonly SessionPoint[];
}

const EMPTY: SessionMetricsSnapshot = { points: [] };

/**
 * What ingest has done since this window opened, one point per read of its `/metrics` (about one a second), for the Analytics
 * page's session charts. The simulator keeps no history of its own (the stream carries the latest read), so the page cannot ask
 * for what happened before it was opened; this is kept from the first message instead, which is why it is a holder of the window
 * and not a state of the page.
 *
 * It lives outside React and outside the Zustand store, as `ObservationLog` does: a point a second for half an hour is not state a
 * render should diff. A read that is stale is not a point and also breaks the chain: the next read has nothing earlier to be
 * compared with, so a rate is never taken across a gap.
 */
export class SessionMetricsStore {
  private readonly capacity: number;
  private points: SessionPoint[] = [];
  private previous: MetricsFeed | null = null;
  private current: SessionMetricsSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();

  constructor(capacity = SESSION_CAPACITY) {
    this.capacity = capacity;
  }

  /** The same object until a point is added, as `useSyncExternalStore` needs. */
  get = (): SessionMetricsSnapshot => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * A read of ingest, from the stream's `metrics` event or from a snapshot. A read already seen (same time) or older than the
   * last point is ignored; a stale one ends the chain.
   */
  record(feed: MetricsFeed): void {
    const point = pointOf(this.previous, feed);
    if (point === null) {
      this.previous = null;
      return;
    }
    const last = this.points.at(-1);
    if (last !== undefined && point.at <= last.at) return;

    this.previous = feed;
    this.points = [...this.points, point].slice(-this.capacity);
    this.current = { points: this.points };
    for (const listener of [...this.listeners]) listener();
  }

  /** Forgets everything, including the read the next one would be compared with. */
  clear(): void {
    this.points = [];
    this.previous = null;
    if (this.current === EMPTY) return;
    this.current = EMPTY;
    for (const listener of [...this.listeners]) listener();
  }
}

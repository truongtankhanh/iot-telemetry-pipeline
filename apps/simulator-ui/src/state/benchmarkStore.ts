import type {
  BenchmarkDetail,
  BenchmarkEvent,
  BenchmarkPhase,
  BenchmarkRunDetail,
  BenchmarkRunSummary,
  BenchmarkSummary,
} from '../api/types';
import { mergeRun } from '../lib/benchmarkSeries';

/** How many finished runs the simulator keeps for the session, and so how many are held here. */
export const MAX_RUNS = 10;

/** Which run is going and in which phase: what a pill needs, and nothing that changes once a second. */
export interface BenchmarkStatus {
  readonly id: number;
  readonly phase: BenchmarkPhase;
}

/** What a reader gets: the same object until the next change, so `useSyncExternalStore` sees no change as no change. */
export interface BenchmarkSnapshot {
  /** The run going now, with its series so far, or `null`. */
  readonly current: BenchmarkRunDetail | null;
  /** Finished runs, newest first, at most `MAX_RUNS`. Do not change it. */
  readonly runs: readonly BenchmarkRunDetail[];
  /**
   * The id and phase of the run going now, or `null`. The same object for as long as both stay the same, so a component that
   * reads only this (the header's pill, the lock) does not render for each point of the series.
   */
  readonly status: BenchmarkStatus | null;
}

const EMPTY: BenchmarkSnapshot = { current: null, runs: [], status: null };

/**
 * The benchmark of this window: the run going and the last ten, with their series. It is built in the browser from three
 * sources that overlap, and merges them so that none is trusted over a newer one:
 *
 * - the stream's snapshot (`seedSummary`): the summary without series, the first message of every connection;
 * - the stream's `benchmark` events (`applyEvent`): the run as it changes, and a point about once a second;
 * - the read of `GET /api/benchmark` (`seedDetail`) that follows a snapshot: the series, which the snapshot does not carry.
 *
 * It lives outside React and outside the Zustand store, as `ObservationLog` and `DemoSessionStore` do: the series is not state a
 * render should diff, and the header's pill and the fleet's lock need to know that a run is going on every page, which
 * `StateView.benchmark` cannot say (the simulator sends no `state` event when a run changes). A point arrives about once a second,
 * so listeners are told at once; there is nothing to throttle.
 */
export class BenchmarkStore {
  private current: BenchmarkRunDetail | null = null;
  /** Newest first. */
  private finished: BenchmarkRunDetail[] = [];
  private snapshot: BenchmarkSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();

  /** The same object until something changes, as `useSyncExternalStore` needs. */
  get = (): BenchmarkSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** A `benchmark` event of the stream: the run, and the point it carries (none on a change of phase). */
  applyEvent(event: BenchmarkEvent): void {
    this.apply(event.run, event.point === null ? [] : [event.point]);
    this.publish();
  }

  /**
   * The summary of a snapshot of the stream. A run that is not known yet is added without a series (the read brings it).
   * A summary whose newest run is older than what is held means the simulator started again and its numbers began at 1: what was
   * held is forgotten first.
   */
  seedSummary(summary: BenchmarkSummary): void {
    const runs = [...(summary.current === null ? [] : [summary.current]), ...summary.runs];
    const newest = runs.reduce((max, run) => Math.max(max, run.id), 0);
    if (newest < this.newestId()) {
      this.current = null;
      this.finished = [];
    }
    for (const run of runs) this.apply(run, []);
    this.publish();
  }

  /** The answer of `GET /api/benchmark`: the runs with their series, merged into what the events brought meanwhile. */
  seedDetail(detail: BenchmarkDetail): void {
    for (const run of [...(detail.current === null ? [] : [detail.current]), ...detail.runs]) {
      this.apply(run, []);
    }
    this.publish();
  }

  /** Forgets everything. */
  clear(): void {
    this.current = null;
    this.finished = [];
    this.publish();
  }

  /** The highest run number held. */
  private newestId(): number {
    return Math.max(this.current?.id ?? 0, this.finished[0]?.id ?? 0);
  }

  /** Puts a run where its phase says: going on, or among the finished ones. A run that ended leaves `current`. */
  private apply(summary: BenchmarkRunSummary, points: BenchmarkRunDetail['series']): void {
    const known =
      this.current?.id === summary.id
        ? this.current
        : this.finished.find((run) => run.id === summary.id);
    const run = mergeRun(known, summary, points);
    if (run === known) return;

    if (run.phase === 'ended') {
      if (this.current?.id === run.id) this.current = null;
      this.finished = [run, ...this.finished.filter((other) => other.id !== run.id)]
        .sort((a, b) => b.id - a.id)
        .slice(0, MAX_RUNS);
    } else {
      this.current = run;
    }
  }

  /** Builds the snapshot again, keeping the objects that did not change, and tells the listeners if anything did. */
  private publish(): void {
    const { current, finished } = this;
    const previous = this.snapshot;
    const sameRuns =
      finished.length === previous.runs.length &&
      finished.every((run, i) => run === previous.runs[i]);
    if (current === previous.current && sameRuns) return;

    const status: BenchmarkStatus | null =
      current === null
        ? null
        : previous.status?.id === current.id && previous.status.phase === current.phase
          ? previous.status
          : { id: current.id, phase: current.phase };
    this.snapshot = { current, runs: sameRuns ? previous.runs : [...finished], status };
    for (const listener of [...this.listeners]) listener();
  }
}

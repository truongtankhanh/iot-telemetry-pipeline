import type { MetricsFeed } from './ingest-poller.ts';
import type { Sample } from './prometheus-text.ts';

/**
 * The ingest counters the effect panel reads, by their names in `/metrics`. They are already among the series the poller
 * forwards (`FORWARDED_METRICS`); the baseline keeps only these, so the state view does not carry the rest twice.
 */
export const FAULT_COUNTERS: readonly string[] = [
  'telemetry_messages_total',
  'telemetry_rejections_total',
  'telemetry_readings_total',
  'telemetry_sequence_gaps_total',
];

/** When the effect began (wall time, ISO 8601) and what the counters said then; `null` when ingest had not been read. */
export interface FaultEffectView {
  since: string;
  baseline: Sample[] | null;
}

export interface FaultEffectOptions {
  /** Wall clock, in milliseconds; not the engine's clock, which may be simulated. */
  now: () => number;
}

/**
 * What the effect panel needs in order to show "the change since the faults were switched on": the moment the first one
 * was switched on, and the counters of ingest at that moment. The page subtracts the baseline from the counters it
 * already has, so the panel survives a reload and is the same in two tabs.
 *
 * The session is not ended by Clear all faults: ingest confirms a gap only after its grace period, so the counters go on
 * moving for a while after the last fault is off, and the operator still wants to read them. It starts again with
 * `restart` ("Reset counters"), or never, if no fault was ever switched on.
 */
export class FaultEffect {
  private readonly now: () => number;
  private session: FaultEffectView | undefined;

  constructor(options: FaultEffectOptions) {
    this.now = options.now;
  }

  /** Begins the session if there is none; a second fault keeps the first one's baseline. */
  ensureStarted(feed: MetricsFeed): void {
    if (this.session === undefined) this.begin(feed);
  }

  /** Begins a new session now, replacing the one there is. */
  restart(feed: MetricsFeed): void {
    this.begin(feed);
  }

  view(): FaultEffectView | null {
    return this.session === undefined ? null : { ...this.session };
  }

  private begin(feed: MetricsFeed): void {
    // A feed that is stale, or was never read, says nothing about the counters now: a baseline from it would be wrong.
    const usable = !feed.stale && feed.lastOkAt !== null;
    this.session = {
      since: new Date(this.now()).toISOString(),
      baseline: usable
        ? feed.samples.filter((sample) => FAULT_COUNTERS.includes(sample.name))
        : null,
    };
  }
}

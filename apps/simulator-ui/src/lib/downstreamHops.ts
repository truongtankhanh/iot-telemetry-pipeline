import type { StateView } from '../api/types';
import { storedReadings } from './ingestRates';

/** The two things Studio watches for something moving after the broker: the stored-readings counter and the alerts. */
export interface HopSnapshot {
  /** Readings ingest has stored, or `null` when not known (a stale feed). */
  readings: number | null;
  alerts: ReadonlyMap<string, { delivery: string | null; preexisting: boolean }>;
}

export function snapshotOf(view: StateView): HopSnapshot {
  return {
    readings: storedReadings(view.metrics),
    alerts: new Map(
      view.alerts.alerts.map((alert) => [
        alert.id,
        { delivery: alert.deliveryStatus, preexisting: alert.preexisting },
      ]),
    ),
  };
}

/**
 * The hops of the pipeline that something measurable crossed between two reads, so a dot may travel their edges
 * (the brief: "a dot travels a line only when the engine published"; past the broker there is no per-message signal,
 * so a dot says "more readings were stored since the last read" or "an alert or its delivery was first seen").
 *
 * - The stored-readings counter grew: broker to ingest, ingest to the rules and ingest to the database.
 * - An alert Studio had not seen appeared (one that was already there when Studio started does not count): the rules to
 *   the alert, and the alert to the outbox.
 * - An alert's delivery became `delivered`: the outbox to the command center.
 *
 * The first read has nothing to compare with and is silent. A counter that went down (ingest restarted) is silent too.
 */
export function advancedHops(previous: HopSnapshot | null, next: HopSnapshot): string[] {
  if (previous === null) return [];
  const hops = new Set<string>();

  if (previous.readings !== null && next.readings !== null && next.readings > previous.readings) {
    hops.add('broker>ingest');
    hops.add('ingest>rules');
    hops.add('ingest>database');
  }

  for (const [id, now] of next.alerts) {
    if (now.preexisting) continue;
    const before = previous.alerts.get(id);
    if (before === undefined) {
      hops.add('rules>alert');
      hops.add('alert>outbox');
    }
    if (now.delivery === 'delivered' && before?.delivery !== 'delivered') {
      hops.add('outbox>commandCenter');
    }
  }
  return [...hops];
}

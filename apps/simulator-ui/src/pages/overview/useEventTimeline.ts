import { useMemo } from 'react';
import { type Density, density } from '../../lib/eventDensity';
import type { EventQuery } from '../../lib/eventQuery';
import {
  type EventRow,
  eventRows,
  type ParsedFilter,
  RANGE_NAMES,
  selectEvents,
  type TimeWindow,
} from '../../lib/eventRows';
import { type FleetPage, paginate } from '../../lib/fleetQuery';
import { useObservations } from '../../state/observationContext';

export interface EventTimeline {
  /** While the log is being read from the simulator: how many events have arrived so far. `null` when it is not. */
  loading: number | null;
  /** Every event the log holds, whatever the range: "the last 5,000 are kept". */
  kept: number;
  /** The rows that pass the range, the source and the filter, newest first: what is exported. */
  rows: readonly EventRow[];
  /** The page of them on show. */
  page: FleetPage<EventRow>;
  window: TimeWindow;
  filter: ParsedFilter;
  density: Density;
  /** "75 events · last hour". */
  summary: string;
  /** "Events 1–10 of 75, newest first": announced politely when it changes. */
  rangeText: string;
}

/**
 * The event timeline, from the observation log and the query of the address. The rows of the log are built once per
 * notification of the log (at most once a second), the selection and the strip once per second of the page's clock
 * (a relative range slides with it), and a page is cut from the selection; nothing here runs per render of the page.
 * A page past the end is the last page, as the table does everywhere.
 */
export function useEventTimeline(query: EventQuery, now: number): EventTimeline {
  const log = useObservations();
  const all = useMemo(() => eventRows(log.events), [log.events]);
  // The end of the current second, so an event Studio saw a moment ago is not left out until the next tick.
  const second = Math.floor(now / 1000) * 1000 + 1000;

  const result = useMemo(
    () =>
      selectEvents(
        all,
        { range: query.range, from: query.from, to: query.to, q: query.q, source: query.source },
        second,
      ),
    [all, query.range, query.from, query.to, query.q, query.source, second],
  );
  const strip = useMemo(
    () =>
      density(
        result.rows.map((row) => row.at),
        result.window,
      ),
    [result],
  );
  const page = useMemo(
    () => paginate(result.rows, query.page, query.size),
    [result.rows, query.page, query.size],
  );

  const count = result.rows.length;
  const when = query.range === 'custom' ? 'custom range' : RANGE_NAMES[query.range];
  return {
    loading: log.loading,
    kept: all.length,
    rows: result.rows,
    page,
    window: result.window,
    filter: result.filter,
    density: strip,
    summary: `${count.toLocaleString('en-US')} ${count === 1 ? 'event' : 'events'} · ${when}`,
    rangeText: `Events ${page.from}–${page.to} of ${count.toLocaleString('en-US')}, newest first`,
  };
}

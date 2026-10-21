import { useId, useState } from 'react';
import { EVENT_SIZES, type EventQuery } from '../../lib/eventQuery';
import { downloadText, eventsToCsv, exportFileName } from '../../lib/eventExport';
import { type TimeZoneChoice, readTimeZone, writeTimeZone } from '../../lib/preferences';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Pager } from '../../ui/Pager';
import { DensityStrip } from './DensityStrip';
import { EventRow } from './EventRow';
import styles from './overview.module.css';
import { TimelineToolbar } from './TimelineToolbar';
import { useEventTimeline } from './useEventTimeline';

/** A row Studio saw this many ms ago still has its wash. */
const FRESH_MS = 3000;

export interface EventTimelineProps {
  query: EventQuery;
  onQuery: (patch: Partial<EventQuery>) => void;
  /** The page's clock, renewed each second: a relative range slides with it. */
  now: number;
}

/**
 * The event timeline (frame 11), in the style of a log viewer: what the simulator saw happen, newest first, in a table
 * that pages (numbered pages at the top and at the bottom, rows per page), a filter, a range, a strip of events per
 * minute whose handles narrow the range, rows that open to their fields, and an export. It reads the observation log
 * (the last 5,000 events of the session); page, size, range, filter and source are in the address.
 */
export function EventTimeline({ query, onQuery, now }: EventTimelineProps) {
  const timeline = useEventTimeline(query, now);
  const [zone, setZone] = useState<TimeZoneChoice>(() => readTimeZone());
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const prefix = useId();
  const { page, loading, kept } = timeline;

  const chooseZone = (next: TimeZoneChoice) => {
    setZone(next);
    writeTimeZone(next);
  };
  const toggle = (id: number) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const exportRows = () => downloadText(exportFileName(query.range), eventsToCsv(timeline.rows));

  const reading = loading !== null && kept === 0;
  const filtered = query.q.trim() !== '' || query.source !== 'all';

  return (
    <Card title="Event timeline" aside={<Chip>{timeline.summary}</Chip>}>
      <TimelineToolbar
        query={query}
        window={timeline.window}
        zone={zone}
        filter={timeline.filter}
        exportable={timeline.rows.length}
        onQuery={onQuery}
        onZone={chooseZone}
        onExport={exportRows}
      />

      <div className={styles.timelinePages}>
        <Pager
          variant="compact"
          label="Events pages (top)"
          noun="Events"
          page={page.page}
          pageSize={query.size}
          total={timeline.rows.length}
          sizes={EVENT_SIZES}
          onPageChange={(next) => onQuery({ page: next })}
          onPageSizeChange={(size) => onQuery({ size, page: 1 })}
        />
      </div>

      <DensityStrip
        density={timeline.density}
        window={timeline.window}
        zone={zone}
        onRange={(from, to) => onQuery({ page: 1, range: 'custom', from, to })}
      />
      <p className={styles.hint}>
        Drag the handles, or use the arrow keys on one, to narrow the range; the table and its pages
        follow. Events are kept for the session (the last 5,000).
      </p>

      {reading ? (
        <p role="status">Loading events… {loading.toLocaleString('en-US')} so far.</p>
      ) : kept === 0 ? (
        <p className={styles.hint} role="status">
          No event has been seen yet. A scenario, a device that is paused or an alert will show
          here.
        </p>
      ) : page.total === 0 ? (
        <div className={styles.status} role="status">
          <span className={styles.statusText}>
            No event {filtered ? 'matches' : 'in this range'}
            {filtered ? ' the filter in this range' : ''}.
          </span>
          {filtered ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onQuery({ page: 1, q: '', source: 'all' })}
            >
              Clear the filter
            </Button>
          ) : null}
        </div>
      ) : (
        <div className={styles.tableWrap} aria-busy={loading !== null || undefined}>
          <table className={styles.events} aria-label="Events">
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Details</span>
                </th>
                <th scope="col">Time{zone === 'utc' ? ' (UTC)' : ''}</th>
                <th scope="col">Source</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((row) => (
                <EventRow
                  key={row.id}
                  row={row}
                  zone={zone}
                  expanded={open.has(row.id)}
                  onToggle={() => toggle(row.id)}
                  fresh={now - row.at >= 0 && now - row.at < FRESH_MS}
                  detailsId={`${prefix}-${row.id}`}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pager
        label="Events pages"
        noun="Events"
        sizeLabel="Rows per page"
        sizes={EVENT_SIZES}
        page={page.page}
        pageSize={query.size}
        total={timeline.rows.length}
        rangeNote="newest first"
        announce
        onPageChange={(next) => onQuery({ page: next })}
        onPageSizeChange={(size) => onQuery({ size, page: 1 })}
      />
    </Card>
  );
}

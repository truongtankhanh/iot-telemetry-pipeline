import { useMemo } from 'react';
import type { ObservedAlert, PagedAlert, RulesView } from '../../api/types';
import { filterBySeverity, filterNote, overlayLive } from '../../lib/alertRows';
import { ALERT_PAGE_SIZES, type AlertsQuery } from '../../lib/alertsQuery';
import { positionText } from '../../lib/cursorPaging';
import { type DependencyNote, dependencyNotes } from '../../lib/dependencyNotes';
import { formatClockTime } from '../../lib/time';
import { useStudio } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { CursorPager } from '../../ui/CursorPager';
import { Icon } from '../../ui/Icon';
import { toneIcons } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import { AlertDetail } from './AlertDetail';
import { AlertList } from './AlertList';
import styles from './alerts.module.css';
import { AlertsToolbar } from './AlertsToolbar';
import { useAlertsPage } from './useAlertsPage';
import { useAlertsParams } from './useAlertsParams';

const NO_ALERTS: readonly ObservedAlert[] = [];
const RULES_UNKNOWN: RulesView = {
  available: false,
  reason: 'The simulator has not sent its rules yet',
  items: [],
};

/** The limits of the pipeline that change what this page can show; the rest are the Topology's to say. */
const BANNER_IDS: readonly DependencyNote['id'][] = [
  'ingest-unreachable',
  'no-alert-sink',
  'delivery-failing',
];

/**
 * What is wrong with ingest or its alert sink, in a sentence each, above the list. Its own component because it needs the
 * whole state view, which is replaced about once a second: the page itself reads only the slices it draws.
 */
function AlertsBanners() {
  const view = useStudio((state) => state.view);
  const lastAlertSink = useStudio((state) => state.lastAlertSink);
  const notes = dependencyNotes(view, lastAlertSink).filter((note) => BANNER_IDS.includes(note.id));
  if (notes.length === 0) return null;
  return (
    <div className={styles.banners}>
      {notes.map((note) => (
        <div
          key={note.id}
          className={styles.banner}
          data-tone={note.tone}
          role={note.tone === 'bad' ? 'alert' : 'status'}
        >
          <Icon glyph={toneIcons[note.tone]} />
          <span className={styles.bannerText}>
            <b>{note.title}.</b> {note.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function emptyMessage(query: AlertsQuery, loaded: number, onClear: () => void) {
  if (loaded > 0) {
    return (
      <div className={styles.empty}>
        <span>No alert on this page has the severity {query.severity}.</span>
        <Button size="sm" variant="outline" onClick={onClear}>
          Show all severities
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.empty}>
      {query.status === 'open' ? 'No alert is open.' : 'No alert has been raised.'}
    </div>
  );
}

/**
 * The Alerts (frame 13): what the rules raised, why, and where each one went. The list is one page of ingest's alerts
 * at a time, newest first, through the simulator (cursor paging: Newer and Older, no page numbers, no total); the
 * detail beside it tells why the chosen alert was raised and follows it from the first breaching reading to the
 * incident, with every time labelled by whose clock it is. What is chosen, filtered and how many are shown is in the
 * address; where the paging has got to is not (a reload opens the newest alerts). It reads the store and the history
 * and keeps no copy of either, except the page of alerts it asked for.
 */
export function Alerts() {
  const hasView = useStudio((state) => state.view !== null);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const live = useStudio((state) => state.view?.alerts.alerts) ?? NO_ALERTS;
  const rules = useStudio((state) => state.view?.rules) ?? RULES_UNKNOWN;
  const consoleUrl = useStudio((state) => state.view?.config.consoleUrl ?? null);
  const ingestStatus = useStudio((state) => state.view?.ingest.status);

  const [query, update] = useAlertsParams();
  const paged = useAlertsPage({ status: query.status, size: query.size });

  const loaded = paged.page?.alerts;
  const rows = useMemo(() => overlayLive(loaded ?? [], live), [loaded, live]);
  const visible = useMemo(() => filterBySeverity(rows, query.severity), [rows, query.severity]);
  const hidden = filterNote(visible.length, rows.length);

  // The alert whose detail is open: the one in the address, else the newest on show. An alert from the address
  // that is not on the page is drawn from the live feed's copy (which carries no cause) with a notice.
  const selectedId = query.alert ?? visible[0]?.id ?? null;
  const onPage = selectedId === null ? undefined : rows.find((alert) => alert.id === selectedId);
  const fromFeed =
    query.alert !== null && onPage === undefined
      ? live.find((alert) => alert.id === query.alert)
      : undefined;
  const detail: PagedAlert | null = onPage ?? (fromFeed ? { ...fromFeed, cause: null } : null);
  const settled = paged.page !== null && paged.status !== 'loading';
  const unknownAlert = query.alert !== null && detail === null && settled;

  const unreachable = ingestStatus === 'unreachable';
  const stale = link === 'lost' || unreachable;
  const chip =
    link === 'lost' ? (
      <Chip tone="bad">
        {lostSince === null ? 'Lost' : `Lost at ${formatClockTime(lostSince)}`}
      </Chip>
    ) : link === 'live' ? (
      <Chip tone="ok">Connected</Chip>
    ) : (
      <Chip>Connecting</Chip>
    );
  const asOf =
    (unreachable || paged.status === 'error') && paged.fetchedAt !== null ? (
      <Chip>As of {formatClockTime(paged.fetchedAt)}</Chip>
    ) : null;

  const select = (id: string) => update({ alert: id });
  // Moving through the pages leaves the chosen alert behind; the newest one on the new page is shown instead.
  const goOlder = () => {
    paged.older();
    update({ alert: null });
  };
  const goNewer = () => {
    paged.newer();
    update({ alert: null });
  };
  const goNewest = () => {
    paged.newest();
    update({ alert: null });
  };

  const header = (
    <PageHeader
      title="Alerts"
      description="What the rules raised, why, and where each one went. An alert becomes an incident only in the Command Center."
    >
      {chip}
    </PageHeader>
  );

  if (!hasView) {
    return (
      <>
        {header}
        <Card title="Alerts">
          <p role="status">
            {link === 'lost'
              ? 'The simulator has not answered yet.'
              : 'Waiting for the first message from the simulator…'}
          </p>
        </Card>
      </>
    );
  }

  const error =
    paged.status === 'error' ? (
      <div className={styles.error} role="alert">
        <span className={styles.bannerText}>
          <b>The alerts could not be read.</b> {paged.error}
        </span>
        <span className={styles.actions}>
          <Button size="sm" variant="outline" onClick={paged.retry}>
            Try again
          </Button>
          {paged.stack.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={goNewest}>
              Back to the newest alerts
            </Button>
          ) : null}
        </span>
      </div>
    ) : null;

  return (
    <div className={styles.page} data-stale={stale ? 'true' : undefined}>
      {header}
      <AlertsBanners />
      <AlertsToolbar query={query} onChange={update} />

      {unknownAlert ? (
        <div className={styles.notice} role="status">
          <span className={styles.bannerText}>
            No alert <span className={styles.mono}>#{query.alert}</span> is on the page shown or in
            the live feed.
          </span>
          <Button size="sm" variant="ghost" onClick={() => update({ alert: null })}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className={styles.cols}>
        <div className={styles.content}>
          <Card title="Alert list" aside={asOf}>
            <div className={styles.list} aria-busy={paged.status === 'loading'}>
              {error}
              {paged.page === null ? (
                paged.status === 'error' ? null : (
                  <p role="status">Loading alerts…</p>
                )
              ) : (
                <>
                  <AlertList
                    rows={visible}
                    selectedId={selectedId}
                    onSelect={select}
                    reference={paged.fetchedAt ?? 0}
                    empty={emptyMessage(query, rows.length, () => update({ severity: 'all' }))}
                  />
                  {hidden ? (
                    <p className={styles.note} role="status">
                      {hidden}
                    </p>
                  ) : null}
                  <CursorPager
                    size={query.size}
                    sizes={ALERT_PAGE_SIZES}
                    onSizeChange={(size) => update({ size, alert: null })}
                    position={positionText(paged.stack, rows.length)}
                    canNewer={paged.canNewer}
                    canOlder={paged.canOlder}
                    onNewer={goNewer}
                    onOlder={goOlder}
                    note="The API pages with a cursor: there are no page numbers and no total."
                  />
                </>
              )}
            </div>
          </Card>
        </div>

        {detail ? (
          <AlertDetail
            alert={detail}
            rules={rules}
            consoleUrl={consoleUrl}
            notOnPage={onPage === undefined}
          />
        ) : (
          <Card title="Alert detail">
            <p className={styles.placeholder}>
              {paged.page === null
                ? 'The alerts are loading.'
                : rows.length === 0
                  ? 'There is no alert to show.'
                  : 'Choose an alert in the list to see why it was raised and where it went.'}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { filterRows, pageRows } from '../../lib/messageQuery';
import type { MessageRow } from '../../lib/messageRows';
import { useMessageLog, useMessages } from '../../state/messageContext';
import { useStudio } from '../../state/studioContext';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { uiIcons } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import styles from './events.module.css';
import { EventsToolbar } from './EventsToolbar';
import { MessageDetail } from './MessageDetail';
import { MessageTable } from './MessageTable';
import { useEventsParams } from './useEventsParams';
import { useMessageTail } from './useMessageTail';
import { useRepublish } from './useRepublish';

const NO_DEVICES: readonly string[] = [];

/**
 * The Event stream (frame 06): the last 200 messages the broker acknowledged, newest first, with filters, pause, clear and
 * numbered paging, and the open message beside them with its command and Republish. Page 1 follows the stream; leaving it, or
 * Pause, holds the list. The simulator samples what it forwards when messages come faster than a budget, and says so: the total
 * and the rate here are exact, and a notice says the list is a sample.
 */
export function Events() {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const rate = useStudio((state) => state.publishRate);
  const log = useMessageLog();
  const messages = useMessages();
  const [query, update] = useEventsParams();
  const republish = useRepublish();

  const tail = useMessageTail({
    rows: messages.rows,
    total: messages.total,
    clearedBefore: messages.clearedBefore,
    page: query.page,
  });
  const { q, device, metric } = query;
  const filtered = useMemo(
    () => filterRows(tail.rows, { q, device, metric }),
    [tail.rows, q, device, metric],
  );
  const paged = pageRows(filtered, query);

  // An address with a page past the end (a shared link, a filter that shrank the list) is rewritten to the page shown.
  useEffect(() => {
    if (paged.page !== query.page) update({ page: paged.page }, { keepPage: true });
  }, [paged.page, query.page, update]);

  // The open message is held by the page, so its detail stays on show after the row has left the log.
  const selectedId = query.message;
  const inList =
    selectedId === null ? null : (messages.rows.find((r) => r.id === selectedId) ?? null);
  const [kept, setKept] = useState<MessageRow | null>(null);
  // Derived while rendering (React renders again at once): the copy follows the open message while it is in the log.
  if (inList !== null && kept?.id !== inList.id) setKept(inList);
  const row = inList ?? (kept !== null && kept.id === selectedId ? kept : null);
  const inLog = selectedId !== null && log.has(selectedId);

  const devices = useMemo(
    () => (view === null ? NO_DEVICES : view.devices.map((device) => device.id)),
    [view],
  );
  const port = view?.broker.port ?? null;
  const isFiltering = q !== '' || device !== null || metric !== null;

  const toggleHold = () => {
    if (tail.following) {
      tail.pause();
      return;
    }
    tail.resume();
    if (query.page !== 1) update({ page: 1 }, { keepPage: true });
  };

  const summary = (
    <>
      Last {tail.rows.length.toLocaleString('en-US')} of {messages.total.toLocaleString('en-US')} ·{' '}
      {rate.toFixed(1)} msg/s
      {messages.sampling === null
        ? ''
        : ` · ${messages.sampling.skipped.toLocaleString('en-US')} skipped in the last ${messages.sampling.windowMs / 1000} s`}
    </>
  );

  const empty =
    isFiltering && tail.rows.length > 0 ? (
      <div className={styles.empty}>
        <span>No message matches the filters.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => update({ q: '', device: null, metric: null })}
        >
          Clear the filters
        </Button>
      </div>
    ) : (
      <div className={styles.empty}>
        <span>
          {messages.clearedBefore > 0
            ? 'Cleared. New messages will show here.'
            : 'Nothing has been published yet. Start a device to see its messages.'}
        </span>
      </div>
    );

  return (
    <div className={styles.page} data-stale={link === 'lost' ? 'true' : undefined}>
      <PageHeader
        title="Event stream"
        description="What the broker acknowledged, newest first. Filter on the topic, the device or a metric."
      >
        <div className={styles.headerActions}>
          {tail.following ? (
            <Chip tone="ok" icon={uiIcons.down}>
              Following
            </Chip>
          ) : (
            <Chip tone="warn" icon={uiIcons.pause}>
              Paused
              {tail.newSinceHeld > 0 ? ` · ${tail.newSinceHeld.toLocaleString('en-US')} new` : ''}
            </Chip>
          )}
          <span className="visually-hidden" role="status">
            {tail.following ? 'Following the stream' : 'Paused'}
          </span>
          <Button
            variant="secondary"
            icon={tail.following ? uiIcons.pause : uiIcons.play}
            onClick={toggleHold}
          >
            {tail.following ? 'Pause' : 'Resume'}
          </Button>
          <Button variant="ghost" icon={uiIcons.trash} onClick={() => log.clear()}>
            Clear
          </Button>
        </div>
      </PageHeader>

      <div className={styles.content}>
        {messages.sampling === null ? null : (
          <Banner tone="info">
            Sampling: the simulator forwards up to{' '}
            {messages.sampling.budgetPerS.toLocaleString('en-US')} messages a second to this page
            and counts the rest. The total and the rate are exact; the list is a sample.
          </Banner>
        )}

        <EventsToolbar query={query} devices={devices} onChange={update} summary={summary} />

        <div className={styles.cols}>
          <Card title="Messages">
            <div className={styles.list}>
              <MessageTable
                rows={paged.rows}
                selectedId={selectedId}
                onSelect={(id) => update({ message: id }, { replace: false, keepPage: true })}
                page={paged.page}
                size={query.size}
                total={paged.total}
                filtered={isFiltering}
                onPageChange={(page) => update({ page })}
                onSizeChange={(size) => update({ size })}
                empty={empty}
              />
            </div>
          </Card>
          <MessageDetail
            row={row}
            selectedId={selectedId}
            inLog={inLog}
            port={port}
            republish={republish}
          />
        </div>
      </div>
    </div>
  );
}

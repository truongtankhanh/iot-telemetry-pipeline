import { useState } from 'react';
import { pauseDevice } from '../../api/client';
import { BULK_CONFIRM_ABOVE, BULK_WORDS } from '../../lib/bulk';
import type { DependencyNote } from '../../lib/dependencyNotes';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { toneIcons, uiIcons } from '../../ui/icons';
import { BulkStatus, type PendingBulk } from '../fleet/BulkStatus';
import { useBulkRun } from '../fleet/useBulkRun';
import styles from './detail.module.css';

/** How often Studio asks ingest again: the poller's own cycle (`IngestPoller`, one second); Studio has no "retry now". */
export const INGEST_RETRY_SECONDS = 1;

export interface DependencyBannersProps {
  notes: readonly DependencyNote[];
  /** The devices that are publishing, which "Pause publishing" would pause. */
  runningDevices: readonly string[];
}

/**
 * What is wrong with what the pipeline depends on, in a sentence each, above the graph (frame 10): ingest unreachable,
 * ingest not ready, no alert sink, delivery failing, the broker disconnected. A problem is a `role="alert"`, a
 * limitation a `role="status"`. With ingest unreachable there is also "Pause publishing", since nothing stores what
 * Studio publishes: it pauses the devices one after another, asking first above ten, as the Fleet's bulk bar does.
 * There is no "Retry now": ingest is asked again every second whatever is pressed.
 */
export function DependencyBanners({ notes, runningDevices }: DependencyBannersProps) {
  const bulk = useBulkRun();
  const [pending, setPending] = useState<PendingBulk | null>(null);
  const idle = notes.length === 0 && pending === null && bulk.state.label === null;
  if (idle) return null;

  const start = (ids: string[]) => {
    setPending(null);
    void bulk.run(ids, BULK_WORDS.pause.doing, pauseDevice);
  };
  const request = () => {
    const ids = [...runningDevices];
    if (ids.length === 0 || bulk.state.running) return;
    if (ids.length > BULK_CONFIRM_ABOVE) setPending({ action: 'pause', ids });
    else start(ids);
  };

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
            {note.id === 'ingest-unreachable' ? ` Retrying every ${INGEST_RETRY_SECONDS} s.` : ''}
          </span>
          {note.id === 'ingest-unreachable' ? (
            <Button
              size="sm"
              variant="outline"
              icon={uiIcons.pause}
              disabled={runningDevices.length === 0 || bulk.state.running}
              onClick={request}
            >
              Pause publishing
            </Button>
          ) : null}
        </div>
      ))}
      <BulkStatus
        pending={pending}
        onConfirm={() => pending && start(pending.ids)}
        onCancelConfirm={() => setPending(null)}
        state={bulk.state}
        onCancelRun={bulk.cancel}
        onDismiss={bulk.dismiss}
      />
    </div>
  );
}

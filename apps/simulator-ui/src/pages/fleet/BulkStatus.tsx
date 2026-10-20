import { useEffect, useRef } from 'react';
import { BULK_WORDS, type BulkAction } from '../../lib/bulk';
import { Button } from '../../ui/Button';
import type { BulkState } from './useBulkRun';
import styles from './bulk.module.css';

/** A run that is waiting for a yes: too many devices to start on one click. */
export interface PendingBulk {
  action: BulkAction;
  ids: string[];
}

export interface BulkStatusProps {
  pending: PendingBulk | null;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  state: BulkState;
  onCancelRun: () => void;
  onDismiss: () => void;
}

/**
 * The three things a bulk run says: the question before it ("Stop 31 devices?"), its progress while it goes, and
 * what happened when it ends, including which devices failed and why. Announced politely, since it changes while
 * the person looks at the table.
 */
export function BulkStatus({
  pending,
  onConfirm,
  onCancelConfirm,
  state,
  onCancelRun,
  onDismiss,
}: BulkStatusProps) {
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pending) confirmButton.current?.focus();
  }, [pending]);

  if (pending) {
    const words = BULK_WORDS[pending.action];
    return (
      <div className={styles.status} role="group" aria-label="Confirm" data-tone="warn">
        <span>
          {words.verb} <b>{pending.ids.length}</b> devices?
        </span>
        <Button ref={confirmButton} size="sm" variant="danger" onClick={onConfirm}>
          {words.verb} {pending.ids.length}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancelConfirm}>
          Cancel
        </Button>
      </div>
    );
  }

  if (state.running) {
    return (
      <div className={styles.status} role="status">
        <span>
          {state.label}… <b>{state.done}</b> of {state.total}
        </span>
        <progress
          value={state.done}
          max={state.total}
          aria-label={`${state.label}, ${state.done} of ${state.total}`}
        />
        <Button size="sm" variant="ghost" onClick={onCancelRun}>
          Stop here
        </Button>
      </div>
    );
  }

  if (state.label === null) return null;

  const failed = state.results.filter((r) => !r.ok);
  const stoppedEarly = state.results.length < state.total;
  return (
    <div className={styles.status} role="status" data-tone={failed.length > 0 ? 'bad' : 'ok'}>
      <div>
        <p className={styles.line}>
          {state.label}: <b>{state.results.length - failed.length}</b> of {state.total} done
          {stoppedEarly ? `, stopped after ${state.results.length}` : ''}
          {failed.length > 0 ? `, ${failed.length} failed` : ''}.
        </p>
        {failed.length > 0 ? (
          <ul className={styles.failures}>
            {failed.map((f) => (
              <li key={f.id}>
                <code>{f.id}</code>: {f.error}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

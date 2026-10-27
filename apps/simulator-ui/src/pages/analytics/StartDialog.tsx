import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { confirmLabel, costLines } from '../../lib/benchmarkStart';
import { useStudioStore } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { useFocusTrap } from '../../ui/useFocusTrap';
import styles from './startDialog.module.css';

export interface StartDialogProps {
  /** The size the person typed, already checked. */
  messages: number;
  /** About how many readings it comes to (`expectedReadingsFor`). */
  readings: number;
  /** `host:port/name` of the database the readings go to; never credentials. */
  database: string | null;
  /** The start is on its way. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before a benchmark starts, and says what it costs: the machine, the live database, the lock, and what Stop does. A benchmark is
 * not something to start by accident (brief R9), so the primary focus is **Cancel**, the button that confirms names the size it
 * will run, and the start is sent only from that button. A modal like the delete dialog: the page behind is inert, Tab stays in, Esc
 * cancels, and the focus goes back to the button that opened it.
 */
export function StartDialog({
  messages,
  readings,
  database,
  busy,
  onConfirm,
  onCancel,
}: StartDialogProps) {
  const store = useStudioStore();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  useFocusTrap(dialog);

  useEffect(() => {
    store.getState().pushModal();
    cancel.current?.focus();
    const returnTo = opener.current;
    return () => {
      store.getState().popModal();
      // The button that asked is disabled once a run exists, and a disabled element cannot take the focus: the page takes it then.
      const target =
        returnTo instanceof HTMLElement &&
        returnTo.isConnected &&
        returnTo !== document.body &&
        !(returnTo instanceof HTMLButtonElement && returnTo.disabled)
          ? returnTo
          : document.getElementById('main');
      target?.focus();
    };
  }, [store]);

  return createPortal(
    <div className={styles.scrim} onMouseDown={onCancel}>
      <div
        ref={dialog}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={titleId} className={styles.title}>
          Start a heavy run?
        </h2>
        <ul className={styles.costs}>
          {costLines({ messages, readings, database }).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className={styles.buttons}>
          <Button ref={cancel} variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {confirmLabel(messages)}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useStudioStore } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { useFocusTrap } from '../../ui/useFocusTrap';
import styles from './deleteDialog.module.css';

export interface DeleteDialogProps {
  /** The scenario to delete. */
  name: string;
  /** The request is on its way. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** The `aria-label` of the button to give the focus back to when the opener is gone (the card's own Delete). */
  returnLabel?: string;
}

/**
 * Asks before a custom scenario is deleted: it removes the scenario and its file from the scenarios folder, and nothing
 * brings it back (Export JSON first if it might be wanted). A modal like the replace dialog: the page behind is inert, Tab stays
 * in, Esc cancels, and the focus goes back to the button that opened it.
 */
export function DeleteDialog({ name, busy, onConfirm, onCancel, returnLabel }: DeleteDialogProps) {
  const store = useStudioStore();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  useFocusTrap(dialog);

  useEffect(() => {
    store.getState().pushModal();
    dialog.current?.focus();
    const returnTo = opener.current;
    return () => {
      store.getState().popModal();
      const target =
        returnTo instanceof HTMLElement && returnTo.isConnected && returnTo !== document.body
          ? returnTo
          : returnLabel === undefined
            ? undefined
            : [...document.querySelectorAll('button')].find(
                (button) => button.getAttribute('aria-label') === returnLabel,
              );
      target?.focus();
    };
  }, [store, returnLabel]);

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
          Delete {name}?
        </h2>
        <p className={styles.lede}>
          This removes <b>{name}</b> and its file from the scenarios folder. It cannot be undone;
          use Export JSON first if you may want it back.
        </p>
        <div className={styles.buttons}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

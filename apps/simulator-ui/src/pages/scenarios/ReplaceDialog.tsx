import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { RunConflict } from '../../api/types';
import { nameList } from '../../lib/scenarioStart';
import { useStudioStore } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { useFocusTrap } from '../../ui/useFocusTrap';
import styles from './replaceDialog.module.css';
import type { PendingReplace } from './useScenarioCommands';

/** What is in the way, one line for each run (with its devices) and one for the anomalies that no run of Studio started. */
function conflictLines(conflicts: readonly RunConflict[]): string[] {
  const devicesOf = (list: readonly RunConflict[]) =>
    nameList([...new Set(list.map((c) => c.deviceId))]);
  const runs = new Map<string, RunConflict[]>();
  const loose: RunConflict[] = [];
  for (const conflict of conflicts) {
    if (conflict.runId === null) {
      loose.push(conflict);
    } else {
      runs.set(conflict.runId, [...(runs.get(conflict.runId) ?? []), conflict]);
    }
  }
  return [
    ...[...runs.values()].map(
      (list) => `The run of ${list[0]?.scenario ?? 'a scenario'}, on ${devicesOf(list)}`,
    ),
    ...(loose.length === 0
      ? []
      : [
          `${loose.length} ${loose.length === 1 ? 'anomaly' : 'anomalies'} that no run of Studio started (the command line's scenario, for one), on ${devicesOf(loose)}`,
        ]),
  ];
}

export interface ReplaceDialogProps {
  pending: PendingReplace;
  /** The repeat of the run is on its way. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before a scenario is run over something that is already playing on its devices: the simulator refused the run
 * and said what is in the way, and the person decides. Replace stops each run in the way as a whole and removes the
 * anomalies that no run owns, then runs the scenario from now. A modal: the page behind is inert, Tab stays in, Esc
 * cancels, focus goes back to the button that opened it.
 */
export function ReplaceDialog({ pending, busy, onConfirm, onCancel }: ReplaceDialogProps) {
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
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
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
          Replace what is running?
        </h2>
        <p className={styles.lede}>
          Running <b>{pending.name}</b> would play over:
        </p>
        <ul className={styles.list}>
          {conflictLines(pending.conflicts).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className={styles.lede}>
          Replacing stops each run above as a whole, also on devices {pending.name} does not use,
          and removes the other anomalies; then {pending.name} runs from now.
        </p>
        <div className={styles.buttons}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            Replace and run
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

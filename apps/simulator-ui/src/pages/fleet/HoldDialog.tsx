import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseHoldValue } from '../../lib/hold';
import { holdMetrics, holdTargets, nameList } from '../../lib/holdTargets';
import type { FleetRow } from '../../lib/fleetQuery';
import { useStudioStore } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { useFocusTrap } from '../../ui/useFocusTrap';
import { HoldField } from './HoldControl';
import styles from './holdDialog.module.css';

export interface HoldDialogProps {
  /** The selected devices. */
  rows: readonly FleetRow[];
  /** Hold `metric` at `value` on these devices; the page runs it and shows its progress. */
  onHold: (metric: string, value: number, ids: string[]) => void;
  onClose: () => void;
}

/**
 * Hold a value on the selected devices (the bulk bar's _Hold value…_; the frame for it does not exist, so it is
 * drawn from the inspector's control). One metric at a time and one value for all, never a value per device. The
 * metric list holds every metric any selected device reports; a device that does not report the chosen one is
 * skipped, and the dialog says which, before anything is sent. A modal: the page behind is inert, Tab stays in,
 * Esc closes, focus goes back to the button that opened it.
 */
export function HoldDialog({ rows, onHold, onClose }: HoldDialogProps) {
  const store = useStudioStore();
  const titleId = useId();
  const metricId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);

  const devices = rows.map((row) => row.device);
  const metrics = holdMetrics(devices);
  const [metric, setMetric] = useState(metrics[0] ?? '');
  const [text, setText] = useState('');
  const { targets, skipped } = holdTargets(devices, metric);
  const parsed = parseHoldValue(text, metric);
  const canHold = parsed.ok && targets.length > 0;

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

  const submit = () => {
    if (parsed.ok && targets.length > 0) {
      onHold(metric, parsed.value, targets);
      onClose();
    }
  };

  return createPortal(
    <div className={styles.scrim} onMouseDown={onClose}>
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
            onClose();
          }
        }}
      >
        <h2 id={titleId} className={styles.title}>
          Hold a value
        </h2>
        <p className={styles.lede}>
          The chosen metric is published at exactly this value, on each device, until it is
          released.
        </p>

        {metrics.length === 0 ? (
          <p className={styles.note}>The selected devices report no metric.</p>
        ) : (
          <>
            <div className={styles.row}>
              <label htmlFor={metricId}>Metric</label>
              <select
                id={metricId}
                className={styles.select}
                value={metric}
                onChange={(event) => {
                  setMetric(event.target.value);
                  setText('');
                }}
              >
                {metrics.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <HoldField metric={metric} text={text} onTextChange={setText} onSubmit={submit} />

            <p className={styles.reach} role="status">
              <b>{targets.length}</b> {targets.length === 1 ? 'device' : 'devices'}
              {skipped.length > 0 ? (
                <>
                  , <b>{skipped.length}</b> skipped because{' '}
                  {skipped.length === 1 ? 'it does' : 'they do'} not report <code>{metric}</code>:{' '}
                  {nameList(skipped)}
                </>
              ) : null}
            </p>
          </>
        )}

        <div className={styles.buttons}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canHold} onClick={submit}>
            {`Hold on ${targets.length} ${targets.length === 1 ? 'device' : 'devices'}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

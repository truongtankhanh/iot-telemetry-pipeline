import { useId, useState } from 'react';
import { holdRangeHint, parseHoldValue } from '../../lib/hold';
import { metricUnit } from '../../lib/deviceIdentity';
import { Button } from '../../ui/Button';
import styles from './holdControl.module.css';

export interface HoldFieldProps {
  metric: string;
  text: string;
  onTextChange: (text: string) => void;
  /** Called when Enter is pressed in the field. */
  onSubmit?: () => void;
  /** The name of the field; default "Hold <metric> at". */
  label?: string;
}

/**
 * The field for a value to hold: a text box with the unit beside it, the range the contract accepts under it, and the
 * reason when the text is not usable. A value outside the range cannot be sent from here (the Faults page is where
 * that is done on purpose), and the message says what the range is.
 */
export function HoldField({ metric, text, onTextChange, onSubmit, label }: HoldFieldProps) {
  const id = useId();
  const parsed = parseHoldValue(text, metric);
  const error = text.trim() !== '' && !parsed.ok ? parsed.message : null;
  const unit = metricUnit(metric);
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label ?? `Hold ${metric} at`}</label>
      <div className={styles.input} data-invalid={error ? 'true' : undefined}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onSubmit) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        {unit ? <span className={styles.unit}>{unit}</span> : null}
      </div>
      <p
        id={`${id}-hint`}
        className={styles.hint}
        data-error={error ? 'true' : undefined}
        role={error ? 'alert' : undefined}
      >
        {error ?? `Accepts ${holdRangeHint(metric)}`}
      </p>
    </div>
  );
}

export interface HoldControlProps {
  metric: string;
  /** The value held now, or `null` when the metric is simulated. */
  held: number | null;
  /** A command for the device is on its way. */
  busy: boolean;
  onHold: (value: number) => void;
  onRelease: () => void;
}

/**
 * Hold one metric of one device at a value, or let it go back to simulating (the inspector's control; the dialog of
 * the bulk bar uses the same field). Hold is for a usable value only; Release is there while one is held.
 */
export function HoldControl({ metric, held, busy, onHold, onRelease }: HoldControlProps) {
  const [text, setText] = useState(held === null ? '' : String(held));
  const parsed = parseHoldValue(text, metric);

  const submit = () => {
    if (parsed.ok && !busy) onHold(parsed.value);
  };

  return (
    <div className={styles.control}>
      <HoldField metric={metric} text={text} onTextChange={setText} onSubmit={submit} />
      <div className={styles.buttons}>
        <Button size="sm" variant="primary" disabled={!parsed.ok || busy} onClick={submit}>
          Hold
        </Button>
        {held !== null ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRelease}>
            Release
          </Button>
        ) : null}
      </div>
    </div>
  );
}

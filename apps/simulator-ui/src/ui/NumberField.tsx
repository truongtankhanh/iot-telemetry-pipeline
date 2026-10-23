import { useId, useState } from 'react';
import styles from './fields.module.css';
import { parseNumber } from './parseNumber';

export interface NumberFieldProps {
  /** What it is, in words: the visible label, or the name a screen reader hears when `hideLabel` is set. */
  label: string;
  /** `null` while the field is empty. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** Called with the value when the person is done: the field loses focus, or Enter is pressed. */
  onCommit?: (value: number | null) => void;
  unit?: string;
  /** The sentence under the field when the value is one the simulator would refuse. */
  error?: string | undefined;
  disabled?: boolean;
  /** The label is only for a screen reader (the field sits beside a slider that is named already). */
  hideLabel?: boolean;
}

/**
 * A number with its unit. While it has focus it shows what was typed (an empty field or "2." is not an error yet); at
 * rest it shows the value in force, so a default or a change made elsewhere is what is on screen. A text field with
 * `inputMode="decimal"`, not `type="number"`: no spinner, no scroll-to-change, and a decimal comma is understood.
 */
export function NumberField({
  label,
  value,
  onChange,
  onCommit,
  unit,
  error,
  disabled,
  hideLabel,
}: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [seen, setSeen] = useState(value);
  // The value in force changed under the field to something other than what was typed (the page put it back, as it does when
  // the simulator refuses a value): show it, instead of the typed text that a blur would then send again.
  if (seen !== value) {
    setSeen(value);
    if (text !== null && parseNumber(text) !== value) setText(null);
  }
  const shown = text ?? (value === null ? '' : String(value));
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : undefined}>
        {label}
      </label>
      <div className={styles.input} data-invalid={error ? 'true' : undefined}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={shown}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onFocus={() => setText(value === null ? '' : String(value))}
          onBlur={(event) => {
            setText(null);
            onCommit?.(parseNumber(event.target.value));
          }}
          onChange={(event) => {
            setText(event.target.value);
            onChange(parseNumber(event.target.value));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit?.(parseNumber(event.currentTarget.value));
          }}
        />
        {unit ? (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

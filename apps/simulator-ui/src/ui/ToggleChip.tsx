import type { ReactNode } from 'react';
import styles from './fields.module.css';

export interface ToggleChipProps {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  children: ReactNode;
  /** A sentence on what it is, for the pointer; the chip's words are its name. */
  title?: string;
  disabled?: boolean;
}

/**
 * A chip that is a switch (one of the kinds of malformed payload): a button with `aria-pressed`, so the keyboard (Space,
 * Enter), the focus ring and the announcement ("pressed") come from the browser. Pressed is said by a mark and a
 * border as well as by the colour.
 */
export function ToggleChip({ pressed, onChange, children, title, disabled }: ToggleChipProps) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={pressed}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!pressed)}
    >
      {children}
    </button>
  );
}

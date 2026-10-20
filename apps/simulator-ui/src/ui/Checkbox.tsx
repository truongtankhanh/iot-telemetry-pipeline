import { useEffect, useRef } from 'react';
import styles from './checkbox.module.css';

export interface CheckboxProps {
  checked: boolean;
  /** Some but not all of what the box stands for: the header box of a page whose rows are part selected. */
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  /** What it selects, for a screen reader ("Select dc-env-01"). A box has no visible text of its own. */
  label: string;
  disabled?: boolean;
}

/**
 * A native checkbox, styled. The native element keeps the keyboard (Space), the focus ring and the
 * announcement for free; `indeterminate` is a property, not an attribute, so it is set from an effect.
 */
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.box}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

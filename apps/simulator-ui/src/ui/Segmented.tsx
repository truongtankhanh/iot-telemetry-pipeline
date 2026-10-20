import { useId } from 'react';
import styles from './controls.module.css';

export interface SegmentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedProps {
  options: readonly SegmentOption[];
  value: string;
  onChange: (value: string) => void;
  /** Names the group for a screen reader ("View"). */
  label: string;
}

/**
 * A choice of one among a few, drawn as joined buttons (Cards or Table; Simulated or Hold value). Native radio
 * buttons underneath, so the arrow keys, the single tab stop and the announcement come from the browser.
 */
export function Segmented({ options, value, onChange, label }: SegmentedProps) {
  const name = useId();
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label
          key={option.value}
          className={styles.segment}
          data-disabled={option.disabled ? 'true' : undefined}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

import styles from './table.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  /** Shown beside the field and its accessible name ("Severity", "Alerts per page"). */
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}

/**
 * A labelled native `<select>`, drawn like the pager's rows-per-page field. Native on purpose: the browser gives
 * the keyboard, the announcement and the mobile picker, and the label wraps the control so it is its name.
 */
export function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return (
    <label className={styles.sizes}>
      <span>{label}</span>
      <select
        className={styles.select}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

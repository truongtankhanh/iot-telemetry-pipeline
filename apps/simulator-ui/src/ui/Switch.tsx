import styles from './controls.module.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What it switches, in words ("Snap to 5 s"): the visible text and the name a screen reader hears. */
  label: string;
  disabled?: boolean;
}

/**
 * An on/off switch with its words beside it. A native checkbox with the `switch` role underneath, so the keyboard (Space),
 * the focus ring and the announcement ("on", "off") come from the browser; the track and the thumb are drawn by the style sheet.
 * The position of the thumb says the state as well as the colour.
 */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <label className={styles.switch} data-disabled={disabled ? 'true' : undefined}>
      <input
        type="checkbox"
        role="switch"
        className={styles.switchInput}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.switchTrack} aria-hidden="true">
        <span className={styles.switchThumb} />
      </span>
      <span className={styles.switchText}>{label}</span>
    </label>
  );
}

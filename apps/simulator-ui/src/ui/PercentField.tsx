import { NumberField } from './NumberField';
import styles from './fields.module.css';

export interface PercentFieldProps {
  /** What it is a share of: "Drop messages". Names the slider ("… slider") and the number. */
  label: string;
  /** `null` while the number field is empty. */
  value: number | null;
  onChange: (value: number | null) => void;
  /**
   * Called when the person is done: the pointer is released or a key is, on the slider, or the number is committed. It can
   * be called twice for the same value (a release and then a blur); the caller sends only a change.
   */
  onCommit: (value: number | null) => void;
  error?: string | undefined;
  disabled?: boolean;
  /** Where the slider ends; the number takes values beyond it, up to 100. */
  trackMax: number;
}

/**
 * A percentage as a slider and a number (frame 07). The slider runs 0 to `trackMax` (20 on the Faults page, where the faults that are
 * worth demonstrating are); the number takes what the simulator takes, up to 100, and the slider rests at its end for a
 * value beyond its track. Dragging changes the draft at once and commits on release, so a drag is one request, not one
 * for every step.
 */
export function PercentField({
  label,
  value,
  onChange,
  onCommit,
  error,
  disabled,
  trackMax,
}: PercentFieldProps) {
  const onTrack = Math.min(Math.max(value ?? 0, 0), trackMax);
  return (
    <div className={styles.percent}>
      <input
        className={styles.range}
        type="range"
        aria-label={`${label} slider`}
        min={0}
        max={trackMax}
        step={0.5}
        value={onTrack}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
        onKeyUp={(event) => {
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
            onCommit(Number(event.currentTarget.value));
          }
        }}
      />
      <div className={styles.percentNumber}>
        <NumberField
          label={`${label} (percent)`}
          hideLabel
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          unit="%"
          error={error}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

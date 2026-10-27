import { type ReactNode, useId } from 'react';
import { formatCount } from '../lib/benchmarkRows';
import styles from './progress.module.css';

export interface ProgressProps {
  /** What is counted, as a heading of the figure: "Published". */
  label: string;
  /** Done so far; `null` when it cannot be known, which is drawn as the word "unknown" and a bar without a length, never as zero. */
  value: number | null;
  /** The total the value is out of. */
  max: number;
  /** What is counted, after the total: "messages". */
  unit: string;
  /** The second bar of a pair is the lighter violet of the second line of a chart. */
  tone?: 'primary' | 'secondary';
  /** A line under the bar: "420 readings still in flight". */
  note?: ReactNode;
}

/**
 * How far something has got, out of a total, in the units it is counted in. The figures are text and the bar is a native
 * `<progress>` with the same numbers as its value text, so neither a screen reader nor a person who cannot tell the colours apart
 * depends on the bar's length. A bar with no known value is indeterminate and says "unknown". It does not animate.
 */
export function Progress({ label, value, max, unit, tone = 'primary', note }: ProgressProps) {
  const labelId = useId();
  const text =
    value === null
      ? `unknown of ${formatCount(max)} ${unit}`
      : `${formatCount(value)} of ${formatCount(max)} ${unit}`;
  return (
    <div className={styles.progress} data-tone={tone}>
      <div className={styles.head}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        <span className={styles.figures}>
          <strong className={styles.value} data-unknown={value === null ? 'true' : undefined}>
            {value === null ? 'unknown' : formatCount(value)}
          </strong>
          <span className={styles.total}>
            / {formatCount(max)} {unit}
          </span>
        </span>
      </div>
      <progress
        className={styles.bar}
        aria-labelledby={labelId}
        aria-valuetext={text}
        max={max}
        {...(value === null ? {} : { value: Math.min(value, max) })}
      />
      {note ? <span className={styles.note}>{note}</span> : null}
    </div>
  );
}

import type { ReactNode } from 'react';
import styles from './analytics.module.css';

export interface StatProps {
  label: string;
  /** The figure; `null` is drawn as the word "unknown", never as a zero. */
  value: string | null;
  unit?: string;
  /** Under the figure: where it comes from, or what it is the figure of. */
  note: ReactNode;
}

/**
 * One figure of the run (frame 09): its label, the number in large type with its unit, and a line of words under it. An unknown figure
 * says "unknown": a tile that showed 0 for a number nobody has read would be a lie that looks like a result.
 */
export function Stat({ label, value, unit, note }: StatProps) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd className={styles.statValue} data-unknown={value === null ? 'true' : undefined}>
        {value === null ? (
          'unknown'
        ) : (
          <>
            {value}
            {unit ? <small> {unit}</small> : null}
          </>
        )}
      </dd>
      <dd className={styles.statNote}>{note}</dd>
    </div>
  );
}

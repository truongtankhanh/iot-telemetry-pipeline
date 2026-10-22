import type { EngineSnapshot } from '../../api/types';
import { windowText } from '../../lib/labFault';
import { Button } from '../../ui/Button';
import styles from './labCanvas.module.css';

/** At most this many faults are listed; the rest are a count. */
const LISTED = 5;

export interface ActiveFaultsProps {
  /** The faults on the engine that no scenario run owns (`looseAnomalies`). */
  faults: EngineSnapshot['anomalies'];
  /** The engine's anomaly clock now, to say when each one plays. */
  elapsedS: number;
  busy: boolean;
  onRemove: (ids: string[]) => void;
}

/**
 * The faults on the engine now that the Lab (or the command line) put there, with a button to take each one out, or all
 * of them. It reads the engine's own list, not the page's memory, so it is right after a reload; it is how a Manual fault
 * is stopped, and how the way is cleared when a new fault would play over one. Nothing is drawn when there is none.
 */
export function ActiveFaults({ faults, elapsedS, busy, onRemove }: ActiveFaultsProps) {
  if (faults.length === 0) return null;
  const listed = faults.slice(0, LISTED);
  return (
    <section className={styles.active} aria-label="Faults on the engine">
      <div className={styles.activeHead}>
        <h3 className={styles.impactTitle}>
          {faults.length} {faults.length === 1 ? 'fault' : 'faults'} on the engine
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onRemove(faults.map((fault) => fault.id))}
        >
          Remove all
        </Button>
      </div>
      <ul className={styles.activeList}>
        {listed.map(({ id, anomaly }) => {
          const from = anomaly.startAt - elapsedS;
          return (
            <li key={id} className={styles.activeRow}>
              <span className={styles.mono}>{anomaly.deviceId}</span>
              <span>
                {anomaly.metric} → {anomaly.value}
              </span>
              <span className={styles.faint}>{windowText(from, from + anomaly.duration)}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Remove the fault on ${anomaly.deviceId} ${anomaly.metric}`}
                onClick={() => onRemove([id])}
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
      {faults.length > LISTED ? (
        <p className={styles.faint}>and {faults.length - LISTED} more</p>
      ) : null}
    </section>
  );
}

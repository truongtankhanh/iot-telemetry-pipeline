import { deltaText, type EffectRow, type FaultEffectModel } from '../../lib/faultEffect';
import { formatAgo } from '../../lib/time';
import { Banner } from '../../ui/Banner';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import styles from './faults.module.css';

export interface EffectPanelProps {
  model: FaultEffectModel;
  /** The time now, in ms, for "4 min ago". */
  now: number;
}

function CounterRow({ row }: { row: EffectRow }) {
  return (
    <li className={styles.counter}>
      <div className={styles.counterName}>
        <span className={styles.mono}>{row.metric}</span>
        <span className={styles.faint}>{row.detail}</span>
      </div>
      <span
        className={styles.delta}
        aria-label={
          row.delta === null ? `${row.metric}: no figure` : `${row.metric}: ${deltaText(row)}`
        }
      >
        {deltaText(row)}
      </span>
    </li>
  );
}

/**
 * "Effect on the pipeline" (frame 07): the change, since the faults were switched on, of the four counters of ingest that show
 * what it did about them (`lib/faultEffect.ts`). It says what it has no figure for instead of showing a zero: before any fault
 * there is nothing to subtract, without a baseline there are no figures, and a counter that went down has none.
 */
export function EffectPanel({ model, now }: EffectPanelProps) {
  const aside = model.status === 'no-baseline' ? <Chip tone="warn">No baseline</Chip> : null;
  return (
    <Card title="Effect on the pipeline" aside={aside}>
      {model.status === 'none' ? (
        <p className={styles.faint}>Switch a fault on to see what ingest counts.</p>
      ) : (
        <div className={styles.effect}>
          <p className={styles.faint}>
            Counters read from ingest <span className={styles.mono}>/metrics</span>, shown as the
            change since the faults were switched on
            {model.since === null ? '' : ` (${formatAgo(Date.parse(model.since), now)})`}.
          </p>
          <ul className={styles.counters} aria-label="Counters of ingest">
            {model.rows.map((row) => (
              <CounterRow key={row.id} row={row} />
            ))}
          </ul>
          {model.notes.map((note) => (
            <Banner key={note} tone="info">
              {note}
            </Banner>
          ))}
        </div>
      )}
    </Card>
  );
}

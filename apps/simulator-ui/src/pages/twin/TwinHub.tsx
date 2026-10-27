import type { HubModel } from '../../lib/twinFlow';
import styles from './twin.module.css';

export interface TwinHubProps {
  hub: HubModel;
  /** One sentence for each fault that is on (`faultVisuals`). */
  faultLines: readonly string[];
}

/**
 * The text twin of the Pipeline hub (SIM-19): what the hub stands for, how it stands, every chip drawn on its label, and
 * each fault that is on, so that with the scene hidden nothing about the data flow is discoverable only in 3D. It is the
 * list's sibling and is hidden the same way (a screen reader reads it; there is nothing in it to focus).
 */
export function TwinHub({ hub, faultLines }: TwinHubProps) {
  const { status, chips } = hub;
  return (
    <section className={styles.devices} aria-label="The Pipeline, as text">
      <h3>Pipeline (logical)</h3>
      <p>
        The hub stands for the broker and ingest. It is a logical object, not a place on the campus.{' '}
        {status.subject}: {status.word}
        {status.detail === null ? '' : ` (${status.detail})`}.
      </p>
      {chips.length === 0 ? null : (
        <ul aria-label="Shown on the hub">
          {chips.map((chip) => (
            <li key={chip.id}>{chip.text}</li>
          ))}
        </ul>
      )}
      {faultLines.length === 0 ? (
        <p>No fault is on.</p>
      ) : (
        <ul aria-label="Faults that are on">
          {faultLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

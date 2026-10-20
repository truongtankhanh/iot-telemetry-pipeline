import { kindIdentity } from '../../lib/deviceIdentity';
import { TOPOLOGY_WORDS, type TopologyState } from '../../lib/topologyState';
import styles from './topology.module.css';

const KINDS = ['server_room', 'indoor_air', 'power_meter'] as const;
const STATES: TopologyState[] = ['healthy', 'anomaly', 'stale', 'down'];

export interface TopologyLegendProps {
  /** "6 devices · 5 zones · 3 problems". */
  summary: string;
}

/**
 * The key to the graph, under it and not over it: the states (an edge style, which the word beside it names), the
 * three shapes of a device, a line that says in words what the graph holds, and the credit for the library. The
 * summary is the text a screen reader gets in place of the picture: how many devices, zones and problems there are.
 */
export function TopologyLegend({ summary }: TopologyLegendProps) {
  return (
    <div className={styles.legend}>
      <ul className={styles.legendList} aria-label="States">
        {STATES.map((state) => (
          <li key={state}>
            <i className={styles.swatch} data-state={state} aria-hidden="true" />
            {TOPOLOGY_WORDS[state]}
          </li>
        ))}
        <li>
          <i className={styles.swatch} data-state="selected" aria-hidden="true" />
          Selected
        </li>
      </ul>
      <ul className={styles.legendList} aria-label="Device classes">
        {KINDS.map((kind) => {
          const identity = kindIdentity(kind);
          return (
            <li key={kind}>
              <i className={styles.shape} data-shape={identity.shape} aria-hidden="true" />
              {identity.label}
            </li>
          );
        })}
      </ul>
      <p className={styles.legendNote}>
        <span>{summary}</span>
        <span>
          Graph drawn with{' '}
          <a href="https://reactflow.dev" target="_blank" rel="noreferrer">
            React Flow
          </a>{' '}
          (MIT)
        </span>
      </p>
    </div>
  );
}

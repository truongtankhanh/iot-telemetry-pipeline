import { kindIdentity } from '../../lib/deviceIdentity';
import { TOPOLOGY_WORDS, type TopologyState } from '../../lib/topologyState';
import topology from '../topology/topology.module.css';
import styles from './twinStage.module.css';

const KINDS = ['server_room', 'indoor_air', 'power_meter'] as const;
/**
 * What a pin and a building can look like in the twin. `down` is the pipeline's: it is a red cross on the hub (and red
 * dashed arcs), and a building did nothing wrong, so no building takes it.
 */
const STATES: TopologyState[] = ['healthy', 'anomaly', 'stale', 'down'];

/**
 * The key to the scene (frame 14), under it and not over it, as the Topology's is: the states — a ring or an outline, which
 * the word beside it names — the three shapes of a device, the beacon of an open alert (a ring in the alert's severity
 * colour; the chip on the label says which), the logical hub (dashed, not a place), and the dashed box of a catalogue
 * asset with the words "not simulated". It uses the Topology's swatches and shapes, so the two pages' keys cannot drift apart.
 */
export function TwinLegend() {
  return (
    <div className={topology.legend}>
      <ul className={topology.legendList} aria-label="States">
        {STATES.map((state) => (
          <li key={state}>
            <i className={topology.swatch} data-state={state} aria-hidden="true" />
            {TOPOLOGY_WORDS[state]}
          </li>
        ))}
        <li>
          <i className={topology.swatch} data-state="selected" aria-hidden="true" />
          Selected
        </li>
      </ul>
      <ul className={topology.legendList} aria-label="Device classes">
        {KINDS.map((kind) => {
          const identity = kindIdentity(kind);
          return (
            <li key={kind}>
              <i className={topology.shape} data-shape={identity.shape} aria-hidden="true" />
              {identity.label}
            </li>
          );
        })}
      </ul>
      <ul className={topology.legendList} aria-label="Data flow and alerts">
        <li>
          <i className={styles.legendBeacon} aria-hidden="true" />
          Open alert: a beacon in the alert&apos;s severity colour
        </li>
        <li>
          <i className={styles.legendHub} aria-hidden="true" />
          Pipeline hub, logical (not a place)
        </li>
      </ul>
      <ul className={topology.legendList} aria-label="Catalogue">
        <li>
          <i className={styles.legendDashed} aria-hidden="true" />
          Catalogue asset, not simulated
        </li>
      </ul>
    </div>
  );
}

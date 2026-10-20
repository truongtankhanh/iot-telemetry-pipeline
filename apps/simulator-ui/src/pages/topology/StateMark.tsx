import { TOPOLOGY_TONES, type TopologyState } from '../../lib/topologyState';
import { Icon } from '../../ui/Icon';
import { toneIcons } from '../../ui/icons';
import styles from './topology.module.css';

export interface StateMarkProps {
  state: TopologyState;
  /** The word for the state of this node: "Running", "Anomaly", "Unreachable", "Not configured"… */
  word: string;
}

/**
 * The icon and the word of a state, which go beside every node's edge light: a state is never colour or light alone
 * (the brief's principle 4). The tone of the icon follows the look; the word says which of the grey ones it is.
 */
export function StateMark({ state, word }: StateMarkProps) {
  return (
    <span className={styles.mark} data-state={state}>
      <Icon glyph={toneIcons[TOPOLOGY_TONES[state]]} size="sm" />
      {word}
    </span>
  );
}

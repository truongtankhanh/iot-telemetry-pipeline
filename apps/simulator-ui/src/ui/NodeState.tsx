import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { type Glyph, toneIcons } from './icons';
import { type NodeStateName, nodeStateWord } from '../lib/nodeState';
import { useAnimationSlot } from './animationBudgetContext';
import styles from './status.module.css';

const ICONS: Record<NodeStateName, Glyph> = {
  healthy: toneIcons.ok,
  anomaly: toneIcons.warn,
  down: toneIcons.bad,
  paused: toneIcons.unknown,
  selected: toneIcons.ok,
};

export interface NodeStateProps {
  state: NodeStateName;
  /** What the node is: "dc-env-01". */
  children: ReactNode;
}

/**
 * A node with the state in its edge light. The light moves (breathes, pulses, flickers) only while the
 * screen's animation budget grants it: at most 12 nodes move, the rest hold their glow still. The state is
 * also its border style (dashed when down), its icon and its word.
 */
export function NodeState({ state, children }: NodeStateProps) {
  const animated = useAnimationSlot('node', state !== 'paused');
  return (
    <div className={styles.node} data-state={state} data-animated={animated ? 'true' : undefined}>
      <span className={styles.nodeIcon}>
        <Icon glyph={ICONS[state]} size="md" />
      </span>
      <span className={styles.nodeText}>
        <span>{children}</span>
        <span className={styles.nodeState}>{nodeStateWord(state)}</span>
      </span>
    </div>
  );
}

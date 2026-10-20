import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { memo, useContext } from 'react';
import type { ZoneNodeData } from '../../lib/topology';
import { TOPOLOGY_WORDS, type TopologyState } from '../../lib/topologyState';
import { useAnimationSlot } from '../../ui/animationBudgetContext';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import { StateMark } from './StateMark';
import { TopologyActionsContext } from './topologyActions';
import styles from './topology.module.css';

export type ZoneFlowNode = Node<ZoneNodeData, 'zone'>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ORDER: TopologyState[] = ['down', 'anomaly', 'stale', 'healthy'];

/** What is not well in a zone, in a few words ("1 anomaly · 1 paused or silent"); "all healthy" when nothing is. */
function problemsOf(counts: ZoneNodeData['counts']): string {
  const parts = ORDER.filter((state) => state !== 'healthy' && counts[state] > 0).map(
    (state) => `${counts[state]} ${TOPOLOGY_WORDS[state].toLowerCase()}`,
  );
  return parts.length === 0 ? 'all healthy' : parts.join(' · ');
}

/**
 * A zone: a box that holds its devices when it is open, and the one node that stands for them when it is not. It says
 * how many devices it has and the worst state among them, so a problem is never hidden by grouping; above 60 devices
 * it shows counts only, with a bar of its states. The chevron opens and closes it in place, unless it is open for a
 * reason of its own (it holds the selection, a search matches in it, every device is shown), and then it says so.
 */
function ZoneNodeView({ data }: NodeProps<ZoneFlowNode>) {
  const actions = useContext(TopologyActionsContext);
  const { code, count, worst, mode, counts, more, locked, selected, dimmed } = data;
  const open = mode === 'open';
  const animated = useAnimationSlot(
    'node',
    !dimmed && (worst === 'anomaly' || worst === 'down') && !open,
  );
  const size = plural(count, 'device');
  const action = open ? 'Close' : 'Open';
  const why = locked
    ? 'It stays open while it holds the selection, matches the search or every device is shown.'
    : '';

  return (
    <div
      className={styles.zone}
      data-mode={mode}
      data-state={worst}
      data-selected={selected ? 'true' : undefined}
      data-dimmed={dimmed ? 'true' : undefined}
      data-animated={animated ? 'true' : undefined}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={false}
        className={styles.handle}
      />
      <div className={styles.zoneHead}>
        <span className={styles.zoneCode}>{code}</span>
        <span className={styles.zoneCount}>{size}</span>
        <button
          type="button"
          className={`${styles.chevron} nodrag nopan`}
          aria-expanded={open}
          aria-disabled={locked ? 'true' : undefined}
          aria-label={`${action} ${code}, ${size}`}
          title={locked ? why : `${action} ${code} in place`}
          onClick={(event) => {
            event.stopPropagation();
            if (!locked) actions.toggleZone(code);
          }}
        >
          <Icon glyph={uiIcons.chevronDown} size="sm" />
        </button>
      </div>
      {mode === 'closed' ? (
        <div className={styles.zoneBody}>
          <StateMark state={worst} word={problemsOf(counts)} />
        </div>
      ) : null}
      {mode === 'counts' ? (
        <div className={styles.zoneBody}>
          <div className={styles.bar} aria-hidden="true">
            {ORDER.filter((state) => counts[state] > 0).map((state) => (
              <span key={state} data-state={state} style={{ flexGrow: counts[state] }} />
            ))}
          </div>
          <StateMark state={worst} word={problemsOf(counts)} />
        </div>
      ) : null}
      {open && more > 0 ? <span className={styles.more}>+ {more} more</span> : null}
    </div>
  );
}

export const ZoneNode = memo(ZoneNodeView);

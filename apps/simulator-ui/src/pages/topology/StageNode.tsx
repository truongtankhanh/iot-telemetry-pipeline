import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import type { StageNodeData } from '../../lib/topology';
import { STAGE_BOXES } from '../../lib/topologyLayout';
import { useAnimationSlot } from '../../ui/animationBudgetContext';
import { Icon } from '../../ui/Icon';
import { stageGlyphs } from '../../ui/icons';
import { StateMark } from './StateMark';
import styles from './topology.module.css';

export type StageFlowNode = Node<StageNodeData, 'stage'>;

/** Under this height a stage has room for its label, its state and one figure, and its detail is left to the tooltip. */
const COMPACT_BELOW = 80;

/**
 * One stage of the pipeline: what it is, its state as an icon and a word, and the one figure Studio can stand behind.
 * A stage whose truth is not known says "Unknown" and the time of its last answer, dimmed; one that is not configured
 * says so. Four handles, all hidden, give the edges a place to meet it.
 */
function StageNodeView({ data }: NodeProps<StageFlowNode>) {
  const { stage, selected } = data;
  const animated = useAnimationSlot(
    'node',
    !stage.dimmed && (stage.state === 'anomaly' || stage.state === 'down' || selected),
  );
  const compact = STAGE_BOXES[stage.id].h < COMPACT_BELOW;
  const tooltip = [stage.headline, stage.detail].filter(Boolean).join(' · ');
  return (
    <div
      className={styles.node}
      data-kind="stage"
      data-compact={compact ? 'true' : undefined}
      data-state={stage.state}
      data-selected={selected ? 'true' : undefined}
      data-dimmed={stage.dimmed ? 'true' : undefined}
      data-animated={animated ? 'true' : undefined}
      title={tooltip === '' ? undefined : tooltip}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        isConnectable={false}
        className={styles.handle}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        isConnectable={false}
        className={styles.handle}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={false}
        className={styles.handle}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectable={false}
        className={styles.handle}
      />
      <span className={styles.stageHead}>
        <Icon glyph={stageGlyphs[stage.id]} size="sm" />
        <span className={styles.stageLabel}>{stage.label}</span>
      </span>
      <StateMark state={stage.state} word={stage.word} />
      {stage.headline ? <span className={styles.headline}>{stage.headline}</span> : null}
      {stage.detail ? <span className={styles.detail}>{stage.detail}</span> : null}
    </div>
  );
}

export const StageNode = memo(StageNodeView);

import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import { kindIdentity } from '../../lib/deviceIdentity';
import type { DeviceNodeData } from '../../lib/topology';
import { useAnimationSlot } from '../../ui/animationBudgetContext';
import { Icon } from '../../ui/Icon';
import { deviceGlyphs } from '../../ui/icons';
import { StateMark } from './StateMark';
import styles from './topology.module.css';

export type DeviceFlowNode = Node<DeviceNodeData, 'device'>;

/**
 * A device in the graph (frame 04): the shape of its kind, its id, the state as an icon and a word, and its newest
 * reading. A paused, stopped or silent device is dark and dashed, with its last reading if it had one. Only a device
 * that needs a look moves (an anomaly pulses, the selected one breathes), which keeps the screen's twelve animated
 * nodes for what matters (D9 of the plan).
 */
function DeviceNodeView({ data }: NodeProps<DeviceFlowNode>) {
  const identity = kindIdentity(data.deviceKind);
  const animated = useAnimationSlot(
    'node',
    !data.dimmed && (data.state === 'anomaly' || data.state === 'down' || data.selected),
  );
  return (
    <div
      className={styles.node}
      data-kind="device"
      data-state={data.state}
      data-selected={data.selected ? 'true' : undefined}
      data-dimmed={data.dimmed ? 'true' : undefined}
      data-animated={animated ? 'true' : undefined}
      title={data.reason ?? data.name}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={false}
        className={styles.handle}
      />
      <span className={styles.face} data-shape={identity.shape} data-state={data.state}>
        <Icon glyph={deviceGlyphs[identity.glyph]} size="sm" />
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{data.deviceId}</span>
        <StateMark state={data.state} word={data.word} />
      </span>
      <span className={styles.value}>{data.reading ?? '—'}</span>
    </div>
  );
}

export const DeviceNode = memo(DeviceNodeView);

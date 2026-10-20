import { type Edge, type EdgeProps, getBezierPath } from '@xyflow/react';
import { memo, useRef } from 'react';
import type { EdgeState } from '../../lib/topology';
import { edgeWidth } from '../../lib/topologyLayout';
import { useAnimationSlot } from '../../ui/animationBudgetContext';
import styles from './topology.module.css';
import { useEdgeDots } from './useEdgeDots';

export type NeonEdgeData = {
  state: EdgeState;
  /** The devices behind the edge: the line is thicker for a zone than for a device. */
  weight: number;
  /** The devices whose published messages draw dots on it. */
  devices: string[];
  /** The hop of a pipeline edge, for the dots that something downstream advanced. */
  hop: string | null;
};

export type NeonFlowEdge = Edge<NeonEdgeData, 'neon'>;

const LIT: readonly EdgeState[] = ['flowing', 'warn', 'ok'];

/**
 * The edge of the topology: three layers (a wide soft halo, a core, and a dashed pulse that marches along it), cyan,
 * amber or green by state. Light means energy is moving, so an edge that carries nothing is a dim dashed wire with no
 * glow, and one into something that is down is a dashed red wire. A glow is stroke layers and a CSS shadow, never an SVG
 * filter (D7 of the plan: a filter box clips under pan and zoom). Which edges move is the animation budget's call,
 * in the order they are drawn (the lit ones first); the dots, at most four, are `useEdgeDots`'s.
 * The edge is decorative (the nodes' words and the detail row carry the same facts) and takes no pointer.
 */
function NeonEdgeView({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<NeonFlowEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const state = data?.state ?? 'off';
  const lit = LIT.includes(state);
  const width = edgeWidth(data?.weight ?? 1);
  const glowing = useAnimationSlot('line', lit);
  const core = useRef<SVGPathElement>(null);
  const layer = useRef<SVGGElement>(null);
  useEdgeDots({ devices: data?.devices ?? [], hop: data?.hop ?? null, state, path: core, layer });

  return (
    <g className={styles.edge} data-state={state} data-glowing={glowing ? 'true' : undefined}>
      <path className={styles.halo} d={path} strokeWidth={width * 4} />
      <path ref={core} className={styles.core} d={path} strokeWidth={width} />
      <path className={styles.pulse} d={path} strokeWidth={width + 0.4} />
      <g ref={layer} className={styles.dots} />
    </g>
  );
}

export const NeonEdge = memo(NeonEdgeView);

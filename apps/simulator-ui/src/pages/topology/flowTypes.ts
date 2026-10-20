import type { EdgeTypes, NodeTypes } from '@xyflow/react';
import { DeviceNode } from './DeviceNode';
import { NeonEdge } from './NeonEdge';
import { StageNode } from './StageNode';
import { ZoneNode } from './ZoneNode';

/**
 * The kinds of node and of edge the graph draws. Defined once, outside any component: React Flow draws every node again
 * when these objects change. In a file of their own because a component file that also exports constants loses fast
 * refresh in development.
 */
export const NODE_TYPES = {
  device: DeviceNode,
  zone: ZoneNode,
  stage: StageNode,
} satisfies NodeTypes;
export const EDGE_TYPES = { neon: NeonEdge } satisfies EdgeTypes;

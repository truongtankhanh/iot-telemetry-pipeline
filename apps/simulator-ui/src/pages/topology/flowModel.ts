import type { Edge, Node } from '@xyflow/react';
import { STAGE_ORDER, type StageId } from '../../lib/pipeline';
import type { Selection, TopoEdge, TopoNode, TopoNodeData } from '../../lib/topology';
import type { TopologyState } from '../../lib/topologyState';
import type { NeonEdgeData } from './NeonEdge';

export type FlowNode = Node<TopoNodeData>;
export type FlowEdge = Edge<NeonEdgeData>;

/**
 * The model's nodes as React Flow wants them. Nothing here moves or connects: the graph is a picture of the store,
 * and a click is a selection in the address, not a drag. `selected` comes from the model (the address), so a reload
 * and a shared link select the same node. The accessible name is the model's, with the state in words.
 */
export function toFlowNodes(nodes: readonly TopoNode[]): FlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
    width: node.width,
    height: node.height,
    data: node.data,
    selected: node.data.selected,
    draggable: false,
    selectable: true,
    connectable: false,
    deletable: false,
    focusable: true,
    ariaLabel: node.data.ariaLabel,
  }));
}

/**
 * The edges are decorative: the nodes' words and the detail row say the same, so no focus, no selection, and they are
 * hidden from a screen reader (which also hides the name React Flow gives an edge by default).
 */
export function toFlowEdges(edges: readonly TopoEdge[]): FlowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    type: 'neon',
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    data: { state: edge.state, weight: edge.weight, devices: edge.devices, hop: edge.hop },
    selectable: false,
    focusable: false,
    deletable: false,
    domAttributes: { 'aria-hidden': true },
  }));
}

const isStage = (value: string): value is StageId =>
  (STAGE_ORDER as readonly string[]).includes(value);

/** What a node id (`device:dc-env-01`, `zone:BLD-DC`, `stage:rules`) selects; `null` for anything else. */
export function selectionFromId(id: string): Selection | null {
  const colon = id.indexOf(':');
  if (colon === -1) return null;
  const kind = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  if (rest === '') return null;
  if (kind === 'device') return { type: 'device', id: rest };
  if (kind === 'zone') return { type: 'zone', id: rest };
  if (kind === 'stage' && isStage(rest)) return { type: 'stage', id: rest };
  return null;
}

/** The look of a node in the minimap: the state it is drawn in, so a problem shows there too. */
export function miniState(node: FlowNode): TopologyState {
  const data = node.data;
  switch (data.kind) {
    case 'device':
      return data.state;
    case 'zone':
      return data.worst;
    case 'stage':
      return data.stage.state;
  }
}

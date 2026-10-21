import {
  MiniMap,
  type NodeChange,
  type NodeSelectionChange,
  type NodeTypes,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { useCallback, useEffect, useMemo } from 'react';
import type { Selection } from '../../lib/topology';
import { type FlowEdge, type FlowNode, miniState, selectionFromId } from './flowModel';
import { EDGE_TYPES, NODE_TYPES } from './flowTypes';
import { TopologyActionsContext } from './topologyActions';
import styles from './topology.module.css';

const MINI_CLASSES = {
  healthy: styles.miniHealthy,
  anomaly: styles.miniAnomaly,
  down: styles.miniDown,
  stale: styles.miniStale,
} as const;

/** Fits the view to the graph when the picture is a different one (another tier, a filter), not when a zone opens. */
function FitOnChange({ fitKey }: { fitKey: string }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.06 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitKey, fitView]);
  return null;
}

export interface TopologyGraphProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** A node was chosen (mouse or keyboard), or the empty canvas was (`null`). */
  onSelect: (selection: Selection | null) => void;
  onToggleZone: (code: string) => void;
  /** When this changes the view is fitted to the graph again. */
  fitKey: string;
  /** For a test that wants to count renders; the real ones by default. */
  nodeTypes?: NodeTypes;
  /** The Overview's card: a shorter canvas and no minimap (the Topology page owns the whole picture). */
  compact?: boolean;
}

/**
 * The graph (frames 04 and 10). It draws what the model says and changes nothing by itself: nodes cannot be dragged or
 * connected, a choice goes to the address through `onSelect`, a zone opens through `onToggleZone`. Tab moves between
 * the nodes and Enter or Space chooses one (React Flow's own keyboard), the wheel does not zoom the page's scroll away
 * (the toolbar and Ctrl with the wheel do), and the only thing drawn over the graph is the minimap.
 */
export function TopologyGraph({
  nodes,
  edges,
  onSelect,
  onToggleZone,
  fitKey,
  nodeTypes = NODE_TYPES,
  compact = false,
}: TopologyGraphProps) {
  const selectedId = nodes.find((node) => node.selected)?.id ?? null;
  const actions = useMemo(() => ({ toggleZone: onToggleZone }), [onToggleZone]);

  // Mouse and keyboard both arrive as a selection change; a click on the node's own chevron does not.
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const selections = changes.filter(
        (change): change is NodeSelectionChange => change.type === 'select',
      );
      const chosen = selections.find((change) => change.selected);
      if (chosen !== undefined) {
        onSelect(selectionFromId(chosen.id));
        return;
      }
      if (selections.some((change) => change.id === selectedId)) onSelect(null);
    },
    [onSelect, selectedId],
  );

  return (
    <TopologyActionsContext.Provider value={actions}>
      <div className={styles.canvas} data-compact={compact ? 'true' : undefined}>
        <ReactFlow<FlowNode, FlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onPaneClick={() => onSelect(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable
          edgesFocusable={false}
          elementsSelectable
          deleteKeyCode={null}
          zoomOnScroll={false}
          preventScrolling={false}
          minZoom={0.25}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.06 }}
          proOptions={{ hideAttribution: true }}
          aria-label="System topology"
        >
          {compact ? null : (
            <MiniMap<FlowNode>
              pannable
              zoomable
              ariaLabel="Minimap of the whole graph"
              nodeClassName={(node) => MINI_CLASSES[miniState(node)] ?? ''}
            />
          )}
          <FitOnChange fitKey={fitKey} />
        </ReactFlow>
      </div>
    </TopologyActionsContext.Provider>
  );
}

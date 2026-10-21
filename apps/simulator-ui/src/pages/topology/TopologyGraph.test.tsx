import type { NodeProps, NodeTypes } from '@xyflow/react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { type ComponentType, memo, useState } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import { Stable } from '../../lib/topologyStable';
import { type FlowEdge, type FlowNode } from './flowModel';
import { NODE_TYPES } from './flowTypes';
import { TopologyGraph } from './TopologyGraph';
import {
  flowOf,
  type FlowModel,
  graphNode,
  installReactFlowStubs,
  renderGraph,
  renderTopology,
} from './topologyTestSupport';

let restoreStubs: () => void;
beforeAll(() => {
  restoreStubs = installReactFlowStubs();
});
afterAll(() => restoreStubs());

const nodeCount = () => document.querySelectorAll('.react-flow__node').length;

/** The real node types, each wrapped to count how often React draws it. */
function countingTypes(renders: Map<string, number>): NodeTypes {
  return Object.fromEntries(
    Object.entries(NODE_TYPES).map(([type, Real]) => {
      const Inner = Real as unknown as ComponentType<NodeProps>;
      const Counted = memo(function Counted(props: NodeProps) {
        renders.set(props.id, (renders.get(props.id) ?? 0) + 1);
        return <Inner {...props} />;
      });
      return [type, Counted];
    }),
  );
}

/** A graph whose nodes and edges a test can replace, the way the page does once a second. */
function Harness({
  initial,
  nodeTypes,
  expose,
}: {
  initial: Pick<FlowModel, 'nodes' | 'edges'>;
  nodeTypes: NodeTypes;
  expose: (set: (next: { nodes: FlowNode[]; edges: FlowEdge[] }) => void) => void;
}) {
  const [model, setModel] = useState(initial);
  expose(setModel);
  return (
    <TopologyGraph
      nodes={model.nodes}
      edges={model.edges}
      nodeTypes={nodeTypes}
      onSelect={() => {}}
      onToggleZone={() => {}}
      fitKey="test"
    />
  );
}

/** The campus with dc-env-02 paused: one device changes state, the rest of the picture is the same. */
const paused = () => {
  const view = structuredClone(stateViewFixture);
  const device = view.engine.devices.find((d) => d.id === 'dc-env-02');
  if (device) device.state = 'paused';
  return flowOf(view);
};

const settle = () =>
  act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))));

describe('a state update re-renders only the nodes that changed', () => {
  async function drawn() {
    const renders = new Map<string, number>();
    let setModel: (next: { nodes: FlowNode[]; edges: FlowEdge[] }) => void = () => {};
    const first = flowOf();
    const nodes = new Stable<FlowNode>();
    const edges = new Stable<FlowEdge>();
    renderTopology(
      <Harness
        initial={{ nodes: nodes.next(first.nodes), edges: edges.next(first.edges) }}
        nodeTypes={countingTypes(renders)}
        expose={(set) => (setModel = set)}
      />,
      { seed: false },
    );
    await waitFor(() => expect(renders.size).toBe(18));
    await settle();
    return { renders, nodes, edges, update: (next: FlowModel) => setModel(next) };
  }

  it('draws the node whose device changed, and not the others', async () => {
    const { renders, nodes, edges, update } = await drawn();
    const before = new Map(renders);
    const next = paused();
    await act(async () => {
      update({
        topology: next.topology,
        nodes: nodes.next(next.nodes),
        edges: edges.next(next.edges),
      });
    });
    await settle();

    expect(renders.get('device:dc-env-02')).toBeGreaterThan(before.get('device:dc-env-02') ?? 0);
    // the zone holding it counts its devices again, so it is drawn again too
    expect(renders.get('zone:BLD-DC')).toBeGreaterThan(before.get('zone:BLD-DC') ?? 0);
    const unchanged = [...before.keys()].filter(
      (id) => id !== 'device:dc-env-02' && id !== 'zone:BLD-DC',
    );
    expect(unchanged).toHaveLength(16);
    for (const id of unchanged) expect(renders.get(id), id).toBe(before.get(id));
  });

  it('would draw every node again if each update handed over fresh objects (why `Stable` exists)', async () => {
    const { renders, update } = await drawn();
    const before = new Map(renders);
    const next = paused(); // equal content, but new objects, and no `Stable` in between
    await act(async () => {
      update({ topology: next.topology, nodes: next.nodes, edges: next.edges });
    });
    await settle();
    const drawnAgain = [...before.keys()].filter(
      (id) => (renders.get(id) ?? 0) > (before.get(id) ?? 0),
    );
    expect(drawnAgain.length).toBeGreaterThan(2);
  });

  it('draws nothing again for an update with the same content', async () => {
    const { renders, nodes, edges, update } = await drawn();
    const before = new Map(renders);
    const same = flowOf();
    await act(async () => {
      update({
        topology: same.topology,
        nodes: nodes.next(same.nodes),
        edges: edges.next(same.edges),
      });
    });
    await settle();
    expect(new Map(renders)).toEqual(before);
  });
});

describe('what the graph reports', () => {
  it('reports a click on a node as a selection', async () => {
    const { onSelect } = renderGraph(flowOf());
    await waitFor(() => expect(graphNode('device:dc-env-01')).not.toBeNull());
    fireEvent.click(graphNode('device:dc-env-01') as HTMLElement);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'device', id: 'dc-env-01' }));
  });

  it('reports a stage and a zone the same way', async () => {
    const { onSelect } = renderGraph(flowOf());
    await waitFor(() => expect(graphNode('stage:rules')).not.toBeNull());
    fireEvent.click(graphNode('stage:rules') as HTMLElement);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'stage', id: 'rules' }));
    fireEvent.click(graphNode('zone:BLD-LIB') as HTMLElement);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'zone', id: 'BLD-LIB' }));
  });

  it('reports a click on the empty canvas as no selection', async () => {
    const { onSelect } = renderGraph(flowOf());
    await waitFor(() => expect(nodeCount()).toBeGreaterThan(0));
    const pane = document.querySelector('.react-flow__pane');
    fireEvent.click(pane as Element);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
  });

  it('asks the page to open a closed zone, and does not select it', async () => {
    const { onSelect, onToggleZone } = renderGraph(flowOf(undefined, { group: 'zone' }));
    await waitFor(() => expect(graphNode('zone:BLD-DC')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Open BLD-DC, 2 devices' }));
    expect(onToggleZone).toHaveBeenCalledWith('BLD-DC');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not close a zone that is open for another reason: its chevron says so', async () => {
    const { onToggleZone } = renderGraph(flowOf());
    await waitFor(() => expect(graphNode('zone:BLD-DC')).not.toBeNull());
    const chevron = screen.getByRole('button', { name: 'Close BLD-DC, 2 devices' });
    expect(chevron).toHaveAttribute('aria-disabled', 'true');
    expect(chevron.getAttribute('title')).toMatch(/stays open/);
    fireEvent.click(chevron);
    expect(onToggleZone).not.toHaveBeenCalled();
  });
});

describe('what is drawn over the graph', () => {
  it('is the minimap and nothing else: no controls, no panel of ours, no library badge', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(nodeCount()).toBeGreaterThan(0));
    expect(document.querySelector('.react-flow__attribution')).toBeNull();
    expect(document.querySelector('.react-flow__controls')).toBeNull();
    expect(document.querySelectorAll('.react-flow__panel')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Minimap of the whole graph' })).toBeInTheDocument();
  });

  it('cannot be dragged, connected or deleted: it is a picture of the store', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(graphNode('device:dc-env-01')).not.toBeNull());
    const node = graphNode('device:dc-env-01') as HTMLElement;
    expect(node.classList.contains('draggable')).toBe(false);
    expect(document.querySelector('.react-flow__handle.connectable')).toBeNull();
  });

  it('makes each node reachable by the keyboard, and not the edges', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(graphNode('device:dc-env-01')).not.toBeNull());
    expect(graphNode('device:dc-env-01')).toHaveAttribute('tabindex', '0');
    for (const edge of document.querySelectorAll('.react-flow__edge')) {
      expect(edge.getAttribute('tabindex')).toBeNull();
      expect(edge.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('the compact graph (the Overview’s card)', () => {
  // The canvas is the parent of React Flow's own element; the nodes carry a `data-compact` of their own.
  const canvas = () => document.querySelector('.react-flow')?.parentElement;

  it('draws no minimap, so nothing at all is drawn over the picture', async () => {
    renderGraph(flowOf(), { compact: true });
    await waitFor(() => expect(nodeCount()).toBeGreaterThan(0));
    expect(document.querySelector('.react-flow__minimap')).toBeNull();
    expect(document.querySelectorAll('.react-flow__panel')).toHaveLength(0);
    expect(canvas()).toHaveAttribute('data-compact', 'true');
  });

  it('draws the same nodes as the full graph', async () => {
    renderGraph(flowOf(), { compact: true });
    await waitFor(() => expect(nodeCount()).toBe(5 + 6 + 7));
  });

  it('is not compact by default: the Topology page keeps its minimap and its height', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(nodeCount()).toBeGreaterThan(0));
    expect(canvas()).not.toHaveAttribute('data-compact');
    expect(document.querySelector('.react-flow__minimap')).not.toBeNull();
  });
});

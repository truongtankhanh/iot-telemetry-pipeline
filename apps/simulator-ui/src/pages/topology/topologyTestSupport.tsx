/**
 * What the tests of the topology share: the stubs React Flow needs in jsdom, and a render that puts a page (or a piece
 * of one) in a router, a store, a history, a pulse bus and an animation budget. Not a `*.test.tsx`, so Vitest does not
 * run it as a test file. The stubs are installed by the tests that draw the graph, not by `src/test-setup.ts`, which
 * every test runs: a graph is the only thing that needs them.
 */
import { Position } from '@xyflow/react';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { type Mock, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { StateView } from '../../api/types';
import { AnimationBudget } from '../../lib/animationBudget';
import { buildFleetRows } from '../../lib/fleetRows';
import { derivePipeline } from '../../lib/pipeline';
import {
  buildTopology,
  type Selection,
  type Topology,
  type TopologyInput,
} from '../../lib/topology';
import { HistoryStore } from '../../state/history';
import { PulseBus } from '../../state/pulses';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { AnimationBudgetProvider } from '../../ui/AnimationBudget';
import { AddressProbe } from '../fleet/AddressProbe';
import { seedHistory } from '../fleet/fleetTestSupport';
import { type FlowEdge, type FlowNode, toFlowEdges, toFlowNodes } from './flowModel';
import { TopologyGraph, type TopologyGraphProps } from './TopologyGraph';

type Restore = () => void;

/** The width and height jsdom has no layout to give: a canvas of a usual size. */
const CANVAS = { width: 1200, height: 700 };

/**
 * jsdom has no `ResizeObserver`, no `DOMMatrixReadOnly`, no layout (`offsetWidth` and `offsetHeight` are 0) and no
 * `getBBox`, and React Flow needs all four to measure a canvas and place its nodes. These are the stand-ins React
 * Flow's own testing guide gives, with a canvas that has a size. Returns the function that puts everything back, for
 * an `afterAll`.
 */
export function installReactFlowStubs(): Restore {
  const restores: Restore[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;

  const define = (name: string, value: unknown) => {
    const had = Object.hasOwn(globals, name);
    const before = globals[name];
    globals[name] = value;
    restores.push(() => {
      if (had) globals[name] = before;
      else delete globals[name];
    });
  };

  // A real observer tells after layout, on a later turn; React Flow measures a node in that callback and needs the
  // canvas to exist by then, so the stand-in answers on the next turn too, not while `observe` runs.
  class ResizeObserverStub {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      const entry = {
        target,
        contentRect: {
          ...CANVAS,
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: CANVAS.width,
          bottom: CANVAS.height,
        },
      } as unknown as ResizeObserverEntry;
      setTimeout(() => this.callback([entry], this as unknown as ResizeObserver), 0);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  define('ResizeObserver', ResizeObserverStub);

  class DOMMatrixReadOnlyStub {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
      this.m22 = scale === undefined ? 1 : Number(scale);
    }
  }
  define('DOMMatrixReadOnly', DOMMatrixReadOnlyStub);

  const proto = HTMLElement.prototype;
  for (const [property, style, fallback] of [
    ['offsetWidth', 'width', CANVAS.width],
    ['offsetHeight', 'height', CANVAS.height],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(proto, property);
    Object.defineProperty(proto, property, {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style[style]) || fallback;
      },
    });
    restores.push(() => {
      if (original) Object.defineProperty(proto, property, original);
      else delete (proto as unknown as Record<string, unknown>)[property];
    });
  }

  const bbox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
  restores.push(() => {
    if (bbox) Object.defineProperty(SVGElement.prototype, 'getBBox', bbox);
    else delete (SVGElement.prototype as unknown as Record<string, unknown>).getBBox;
  });

  return () => restores.reverse().forEach((restore) => restore());
}

export interface RenderTopologyOptions {
  /** The address to open (`/topology?device=dc-env-01`). */
  path?: string;
  link?: LinkState;
  /** The state view; the fixture's six devices by default, `null` for the page before its first message. */
  view?: StateView | null;
  /** Seed the history with a few seconds of readings (the fixture's story). */
  seed?: boolean;
  /** A bus of the test's own, to emit pulses into. */
  pulses?: PulseBus;
}

export type TopologyHarness = RenderResult & {
  store: StudioStore;
  history: HistoryStore;
  pulses: PulseBus;
  budget: AnimationBudget;
};

/** Renders a topology element at `/topology` inside everything the page reads. */
export function renderTopology(
  element: ReactElement,
  options: RenderTopologyOptions = {},
): TopologyHarness {
  const { path = '/topology', link = 'live', seed = true } = options;
  const view = options.view === undefined ? structuredClone(stateViewFixture) : options.view;
  const store = createStudioStore();
  store.getState().setLink(link, Date.now());
  if (view) store.getState().setView(structuredClone(view), Date.now());
  const history = new HistoryStore();
  if (view && seed) seedHistory(history, view);
  const pulses = options.pulses ?? new PulseBus();
  const budget = new AnimationBudget();

  const result = render(
    <StudioProvider store={store} history={history} pulses={pulses}>
      <AnimationBudgetProvider budget={budget}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/topology" element={element} />
          </Routes>
          <AddressProbe />
        </MemoryRouter>
      </AnimationBudgetProvider>
    </StudioProvider>,
  );
  return { ...result, store, history, pulses, budget };
}

export { address } from '../fleet/fleetTestSupport';

export interface FlowModel {
  topology: Topology;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * The topology of a view as React Flow's nodes and edges, built the way the page builds them, from the history seeded
 * with the fixture's story (dc-env-01 and lha-air-01 above their raise lines, hub-power-01 paused): six devices in five
 * zones with three problems. `options` changes what the page's address would.
 */
export function flowOf(
  view: StateView = stateViewFixture,
  options: Partial<TopologyInput> = {},
): FlowModel {
  const history = new HistoryStore();
  seedHistory(history, view);
  const seriesOf = (deviceId: string, metric: string) => history.snapshot(deviceId, metric);
  const rows = buildFleetRows({
    view,
    now: Date.now(),
    seriesOf,
    lastSeenOf: (deviceId) => history.deviceSnapshot(deviceId).lastSeen,
  });
  const link = options.link ?? 'live';
  const stages = derivePipeline({
    view,
    link,
    lastAlertSink: view.ingest.alertSink,
    rows,
    seriesOf,
    rates: { storedPerSecond: null, lagSeconds: null },
    publishRate: 2,
  });
  const topology = buildTopology({
    rows,
    stages,
    search: '',
    group: null,
    problemsOnly: false,
    expanded: new Set(),
    selection: null,
    link,
    ...options,
  });
  return { topology, nodes: toFlowNodes(topology.nodes), edges: toFlowEdges(topology.edges) };
}

/**
 * Gives each node the handles it really has, with their places, so React Flow can draw an edge without measuring the
 * DOM (it takes `handles` as the bounds when a node has them). jsdom has no layout, so a measurement is all zeros.
 */
export function withHandles(nodes: readonly FlowNode[]): FlowNode[] {
  return nodes.map((node) => {
    const w = node.width ?? 0;
    const h = node.height ?? 0;
    const right = {
      id: 'right',
      type: 'source' as const,
      position: Position.Right,
      x: w,
      y: h / 2,
    };
    const handles =
      node.type === 'stage'
        ? [
            { id: 'left', type: 'target' as const, position: Position.Left, x: 0, y: h / 2 },
            { id: 'top', type: 'target' as const, position: Position.Top, x: w / 2, y: 0 },
            right,
            { id: 'bottom', type: 'source' as const, position: Position.Bottom, x: w / 2, y: h },
          ]
        : [right];
    return { ...node, handles };
  });
}

/** The graph's harness, with the spies. Its type is written out: an inferred one would name pnpm's store paths (TS2742). */
export type GraphHarness = TopologyHarness & {
  onSelect: Mock<(selection: Selection | null) => void>;
  onToggleZone: Mock<(code: string) => void>;
};

/** Draws nodes and edges in the graph alone, with spies for what it reports. */
export function renderGraph(
  model: Pick<FlowModel, 'nodes' | 'edges'>,
  props: Partial<TopologyGraphProps> = {},
  options: RenderTopologyOptions = {},
): GraphHarness {
  const onSelect = vi.fn<(selection: Selection | null) => void>();
  const onToggleZone = vi.fn<(code: string) => void>();
  const result = renderTopology(
    <TopologyGraph
      nodes={withHandles(model.nodes)}
      edges={model.edges}
      onSelect={onSelect}
      onToggleZone={onToggleZone}
      fitKey="test"
      {...props}
    />,
    { seed: false, ...options },
  );
  return { ...result, onSelect, onToggleZone };
}

/** A node of the graph by its id (`device:dc-env-01`, `zone:BLD-DC`, `stage:rules`). */
export const graphNode = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);

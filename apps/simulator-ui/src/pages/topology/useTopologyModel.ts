import { useState } from 'react';
import type { MetricsFeed, StateView } from '../../api/types';
import type { FleetRow } from '../../lib/fleetQuery';
import { type IngestRates, ingestRates } from '../../lib/ingestRates';
import { derivePipeline, type StageNode } from '../../lib/pipeline';
import { buildTopology, type Topology } from '../../lib/topology';
import type { TopologyQuery } from '../../lib/topologyQuery';
import { Stable } from '../../lib/topologyStable';
import { useHistoryStore } from '../../state/historyContext';
import type { LinkState } from '../../state/store';
import { useFleetRows } from '../fleet/useFleetRows';
import { type FlowEdge, type FlowNode, toFlowEdges, toFlowNodes } from './flowModel';

const NO_RATES: IngestRates = { storedPerSecond: null, lagSeconds: null };

/**
 * What ingest did between the last two reads of its metrics. Kept as state that is adjusted while rendering (React's
 * own pattern for "this prop changed"), so there is no effect and no ref written during a render: when a new feed
 * arrives it is compared with the one before, once.
 */
export function useIngestRates(feed: MetricsFeed | undefined): IngestRates {
  const [state, setState] = useState<{ feed: MetricsFeed | undefined; rates: IngestRates }>({
    feed: undefined,
    rates: NO_RATES,
  });
  if (feed !== state.feed) {
    setState({
      feed,
      rates:
        feed !== undefined && state.feed !== undefined ? ingestRates(state.feed, feed) : NO_RATES,
    });
  }
  return state.rates;
}

export interface TopologyModelInput {
  /** `null` before the first message from the simulator. */
  view: StateView | null;
  link: LinkState;
  lastAlertSink: string | null;
  publishRate: number;
  /** The clock of the page, renewed each second: a device that says nothing becomes silent by it. */
  now: number;
  query: TopologyQuery;
  /** The zones the viewer opened. */
  expanded: ReadonlySet<string>;
}

export interface TopologyModel {
  topology: Topology;
  rows: FleetRow[];
  stages: StageNode[];
  /** React Flow's nodes and edges, with the same object for everything that did not change. */
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Everything the page and the graph need, from the store and the history: the devices with their state, the seven
 * stages, the topology, and React Flow's nodes and edges. The page renders about once a second (the clock, the
 * metrics) and rebuilds all of it; `Stable` hands React Flow the same object for every node and edge whose content did
 * not change, which is what makes a state update re-render only the nodes that changed (D4 of the plan).
 */
export function useTopologyModel(input: TopologyModelInput): TopologyModel | null {
  const { view, link, lastAlertSink, publishRate, now, query, expanded } = input;
  const history = useHistoryStore();
  const rows = useFleetRows(view, now);
  const rates = useIngestRates(view?.metrics);
  const [nodeCache] = useState(() => new Stable<FlowNode>());
  const [edgeCache] = useState(() => new Stable<FlowEdge>());

  if (view === null) return null;
  const stages = derivePipeline({
    view,
    link,
    lastAlertSink,
    rows,
    seriesOf: (deviceId, metric) => history.snapshot(deviceId, metric),
    rates,
    publishRate,
  });
  const topology = buildTopology({
    rows,
    stages,
    search: query.q,
    group: query.group,
    problemsOnly: query.problems,
    expanded,
    selection: query.selection,
    link,
  });
  return {
    topology,
    rows,
    stages,
    nodes: nodeCache.next(toFlowNodes(topology.nodes)),
    edges: edgeCache.next(toFlowEdges(topology.edges)),
  };
}

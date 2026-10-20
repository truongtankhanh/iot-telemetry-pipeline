import type { DeviceStatusKind } from './deviceStatus';

/**
 * How a node of the topology is drawn (frames 04 and 10). A device that is paused, stopped or silent, and a stage
 * whose truth is not known, share one look: dark and dashed (`stale`). The word beside the node says which of them
 * it is, so the look never carries the meaning alone.
 */
export type TopologyState = 'healthy' | 'anomaly' | 'down' | 'stale';

/** The generic word of each look, for a group of nodes; a node carries its own, more exact word. */
export const TOPOLOGY_WORDS: Record<TopologyState, string> = {
  healthy: 'Healthy',
  anomaly: 'Anomaly',
  down: 'Down',
  stale: 'Paused or silent',
};

// The brief: "the worst state of a group is the worst of its devices (down, then anomaly, then paused or silent,
// then healthy), so a problem is never hidden by grouping."
const SEVERITY: Record<TopologyState, number> = { healthy: 0, stale: 1, anomaly: 2, down: 3 };

/** The worst of some states; `null` for none. */
export function worstOf(states: Iterable<TopologyState>): TopologyState | null {
  let worst: TopologyState | null = null;
  for (const state of states) {
    if (worst === null || SEVERITY[state] > SEVERITY[worst]) worst = state;
  }
  return worst;
}

/**
 * The look of a device. Frames 04 and 10 draw silent like paused (grey, dashed), and the brief counts them together;
 * the Fleet draws a silent device red (analysis, Q5). Topology follows the frames, and the node's word, taken from the
 * device's own status, still says "Silent".
 */
export function deviceTopologyState(kind: DeviceStatusKind): TopologyState {
  switch (kind) {
    case 'running':
      return 'healthy';
    case 'anomaly':
      return 'anomaly';
    case 'silent':
    case 'paused':
    case 'stopped':
      return 'stale';
  }
}

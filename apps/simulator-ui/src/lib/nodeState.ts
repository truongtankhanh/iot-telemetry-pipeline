/** The states of a node and of a device badge in frame 00. Paused and silent stay dark. */
export type NodeStateName = 'healthy' | 'anomaly' | 'down' | 'paused' | 'selected';

const WORDS: Record<NodeStateName, string> = {
  healthy: 'Healthy',
  anomaly: 'Anomaly',
  down: 'Down',
  paused: 'Paused',
  selected: 'Selected',
};

/** The word for a state: a state is never colour or light alone. */
export const nodeStateWord = (state: NodeStateName): string => WORDS[state];

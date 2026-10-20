import { createContext } from 'react';

/** What a node can ask the page to do. They are not in a node's data, which stays plain values that can be compared. */
export interface TopologyActions {
  /** Opens a closed zone in place, or closes one the viewer opened. */
  toggleZone(code: string): void;
}

/** Without a page above it (a node drawn on its own in a test) the actions do nothing. */
export const TopologyActionsContext = createContext<TopologyActions>({ toggleZone: () => {} });

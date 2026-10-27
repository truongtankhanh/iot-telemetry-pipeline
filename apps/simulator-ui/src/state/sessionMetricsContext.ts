import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SessionMetricsSnapshot, SessionMetricsStore } from './sessionMetricsStore';

/** The session's metrics of this window. Provided once by `StudioProvider`; a test provides its own. */
export const SessionMetricsContext = createContext<SessionMetricsStore | null>(null);

export function useSessionMetricsStore(): SessionMetricsStore {
  const store = useContext(SessionMetricsContext);
  if (store === null) throw new Error('The session metrics need a StudioProvider above it');
  return store;
}

/** The points of the session, oldest first, as of the last read of ingest (about once a second). Do not change the array. */
export function useSessionMetrics(): SessionMetricsSnapshot {
  const store = useSessionMetricsStore();
  return useSyncExternalStore(store.subscribe, store.get);
}

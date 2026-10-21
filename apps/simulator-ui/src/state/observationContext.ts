import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { ObservationLog, ObservationLogSnapshot } from './observationLog';

/** The observation log of this window. Provided once by `StudioProvider`; a test provides its own. */
export const ObservationContext = createContext<ObservationLog | null>(null);

export function useObservationLog(): ObservationLog {
  const log = useContext(ObservationContext);
  if (log === null) throw new Error('The observation log needs a StudioProvider above it');
  return log;
}

/**
 * The observations as of the last notification (at most once a second for live events, at once for a read that
 * finished): newest first, with the newest id and how far a read of the simulator has got. Do not change the array.
 */
export function useObservations(): ObservationLogSnapshot {
  const log = useObservationLog();
  const subscribe = useCallback((listener: () => void) => log.subscribe(listener), [log]);
  return useSyncExternalStore(subscribe, () => log.snapshot());
}

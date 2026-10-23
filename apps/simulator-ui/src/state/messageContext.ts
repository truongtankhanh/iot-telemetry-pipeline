import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { MessageLog, MessageLogSnapshot } from './messageLog';

/** The message log of this window. Provided once by `StudioProvider`; a test provides its own. */
export const MessageContext = createContext<MessageLog | null>(null);

export function useMessageLog(): MessageLog {
  const log = useContext(MessageContext);
  if (log === null) throw new Error('The message log needs a StudioProvider above it');
  return log;
}

/**
 * The messages as of the last notification (at most every 250 ms for live ones, at once for a snapshot, a clear or a
 * sampling report): newest first, with the exact total and whether the simulator is sampling. Do not change the array.
 */
export function useMessages(): MessageLogSnapshot {
  const log = useMessageLog();
  const subscribe = useCallback((listener: () => void) => log.subscribe(listener), [log]);
  return useSyncExternalStore(subscribe, () => log.snapshot());
}

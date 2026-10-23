import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DemoSessionState } from '../lib/demoSession';
import type { DemoSessionStore } from './demoSessionStore';

/** The guided demo's session of this window. Provided once by `StudioProvider`; a test provides its own. */
export const DemoSessionContext = createContext<DemoSessionStore | null>(null);

export function useDemoSessionStore(): DemoSessionStore {
  const store = useContext(DemoSessionContext);
  if (store === null) throw new Error('The demo session needs a StudioProvider above it');
  return store;
}

/** The session as of the last action; the same object until the next. */
export function useDemoSession(): DemoSessionState {
  const store = useDemoSessionStore();
  return useSyncExternalStore(store.subscribe, store.get);
}

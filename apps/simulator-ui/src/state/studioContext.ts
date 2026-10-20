import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { StudioState, StudioStore } from './store';

/** The store of this window. Provided once by `StudioProvider`; a test provides its own. */
export const StudioContext = createContext<StudioStore | null>(null);

export function useStudioStore(): StudioStore {
  const store = useContext(StudioContext);
  if (store === null) throw new Error('useStudio needs a StudioProvider above it');
  return store;
}

/** Subscribes to a slice: the component renders again only when what `selector` returns changes. */
export function useStudio<T>(selector: (state: StudioState) => T): T {
  return useStore(useStudioStore(), selector);
}

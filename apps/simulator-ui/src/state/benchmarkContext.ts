import { createContext, useContext, useSyncExternalStore } from 'react';
import type { BenchmarkSnapshot, BenchmarkStatus, BenchmarkStore } from './benchmarkStore';

/** The benchmark of this window. Provided once by `StudioProvider`; a test provides its own. */
export const BenchmarkContext = createContext<BenchmarkStore | null>(null);

export function useBenchmarkStore(): BenchmarkStore {
  const store = useContext(BenchmarkContext);
  if (store === null) throw new Error('The benchmark needs a StudioProvider above it');
  return store;
}

/**
 * The run going and the finished ones, with their series, as of the last change. A point arrives about once a second, so this
 * renders about once a second while a run goes: the page that draws the series reads it, a component that only needs to know
 * that a run is going reads `useBenchmarkStatus`.
 */
export function useBenchmark(): BenchmarkSnapshot {
  const store = useBenchmarkStore();
  return useSyncExternalStore(store.subscribe, store.get);
}

/** The id and phase of the run going, or `null`: it changes when a run starts, changes phase or ends, not for each point. */
export function useBenchmarkStatus(): BenchmarkStatus | null {
  const store = useBenchmarkStore();
  return useSyncExternalStore(store.subscribe, () => store.get().status);
}

/** Whether a run is going (also while it starts and while it waits for the readings to be stored). */
export function useBenchmarkRunning(): boolean {
  return useBenchmarkStatus() !== null;
}

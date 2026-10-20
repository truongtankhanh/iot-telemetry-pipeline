import type { ReactNode } from 'react';
import { StudioContext } from './studioContext';
import type { StudioStore } from './store';

export function StudioProvider({ store, children }: { store: StudioStore; children: ReactNode }) {
  return <StudioContext.Provider value={store}>{children}</StudioContext.Provider>;
}

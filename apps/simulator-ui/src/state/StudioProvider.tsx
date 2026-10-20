import { type ReactNode, useState } from 'react';
import { HistoryStore } from './history';
import { HistoryContext } from './historyContext';
import { StudioContext } from './studioContext';
import type { StudioStore } from './store';

/**
 * Gives the components of one window their store and their history. A history that is not passed in is created
 * (a test that does not draw a chart need not know about it).
 */
export function StudioProvider({
  store,
  history,
  children,
}: {
  store: StudioStore;
  history?: HistoryStore;
  children: ReactNode;
}) {
  const [own] = useState(() => new HistoryStore());
  return (
    <StudioContext.Provider value={store}>
      <HistoryContext.Provider value={history ?? own}>{children}</HistoryContext.Provider>
    </StudioContext.Provider>
  );
}

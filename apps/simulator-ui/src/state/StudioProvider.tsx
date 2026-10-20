import { type ReactNode, useState } from 'react';
import { HistoryStore } from './history';
import { HistoryContext } from './historyContext';
import { PulseBus } from './pulses';
import { PulseContext } from './pulseContext';
import { StudioContext } from './studioContext';
import type { StudioStore } from './store';

/**
 * Gives the components of one window their store, their history and their pulse bus. A history or a bus that is not
 * passed in is created (a test that does not draw a chart or a graph need not know about it).
 */
export function StudioProvider({
  store,
  history,
  pulses,
  children,
}: {
  store: StudioStore;
  history?: HistoryStore;
  pulses?: PulseBus;
  children: ReactNode;
}) {
  const [ownHistory] = useState(() => new HistoryStore());
  const [ownPulses] = useState(() => new PulseBus());
  return (
    <StudioContext.Provider value={store}>
      <HistoryContext.Provider value={history ?? ownHistory}>
        <PulseContext.Provider value={pulses ?? ownPulses}>{children}</PulseContext.Provider>
      </HistoryContext.Provider>
    </StudioContext.Provider>
  );
}

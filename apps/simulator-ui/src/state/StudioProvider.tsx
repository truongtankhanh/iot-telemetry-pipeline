import { type ReactNode, useState } from 'react';
import { HistoryStore } from './history';
import { HistoryContext } from './historyContext';
import { ObservationContext } from './observationContext';
import { ObservationLog } from './observationLog';
import { PulseBus } from './pulses';
import { PulseContext } from './pulseContext';
import { StudioContext } from './studioContext';
import type { StudioStore } from './store';

/**
 * Gives the components of one window their store, their history, their pulse bus and their observation log. A history,
 * a bus or a log that is not passed in is created (a test that does not draw a chart, a graph or the timeline need not
 * know about it).
 */
export function StudioProvider({
  store,
  history,
  pulses,
  observations,
  children,
}: {
  store: StudioStore;
  history?: HistoryStore;
  pulses?: PulseBus;
  observations?: ObservationLog;
  children: ReactNode;
}) {
  const [ownHistory] = useState(() => new HistoryStore());
  const [ownPulses] = useState(() => new PulseBus());
  const [ownObservations] = useState(() => new ObservationLog());
  return (
    <StudioContext.Provider value={store}>
      <HistoryContext.Provider value={history ?? ownHistory}>
        <PulseContext.Provider value={pulses ?? ownPulses}>
          <ObservationContext.Provider value={observations ?? ownObservations}>
            {children}
          </ObservationContext.Provider>
        </PulseContext.Provider>
      </HistoryContext.Provider>
    </StudioContext.Provider>
  );
}

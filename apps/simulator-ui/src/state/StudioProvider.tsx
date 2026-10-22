import { type ReactNode, useState } from 'react';
import { EditorDrafts } from './editorDrafts';
import { EditorDraftsContext } from './editorDraftsContext';
import { HistoryStore } from './history';
import { HistoryContext } from './historyContext';
import { ObservationContext } from './observationContext';
import { ObservationLog } from './observationLog';
import { PulseBus } from './pulses';
import { PulseContext } from './pulseContext';
import { StudioContext } from './studioContext';
import type { StudioStore } from './store';

/**
 * Gives the components of one window their store, their history, their pulse bus, their observation log and the timeline
 * editor's working copies. A history, a bus, a log or a set of copies that is not passed in is created (a test that does not
 * draw a chart, a graph, the timeline or the editor need not know about it).
 */
export function StudioProvider({
  store,
  history,
  pulses,
  observations,
  drafts,
  children,
}: {
  store: StudioStore;
  history?: HistoryStore;
  pulses?: PulseBus;
  observations?: ObservationLog;
  drafts?: EditorDrafts;
  children: ReactNode;
}) {
  const [ownHistory] = useState(() => new HistoryStore());
  const [ownPulses] = useState(() => new PulseBus());
  const [ownObservations] = useState(() => new ObservationLog());
  const [ownDrafts] = useState(() => new EditorDrafts());
  return (
    <StudioContext.Provider value={store}>
      <HistoryContext.Provider value={history ?? ownHistory}>
        <PulseContext.Provider value={pulses ?? ownPulses}>
          <ObservationContext.Provider value={observations ?? ownObservations}>
            <EditorDraftsContext.Provider value={drafts ?? ownDrafts}>
              {children}
            </EditorDraftsContext.Provider>
          </ObservationContext.Provider>
        </PulseContext.Provider>
      </HistoryContext.Provider>
    </StudioContext.Provider>
  );
}

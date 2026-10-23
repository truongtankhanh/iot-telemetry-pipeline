import { type ReactNode, useState } from 'react';
import { DemoSessionContext } from './demoSessionContext';
import { DemoSessionStore } from './demoSessionStore';
import { EditorDrafts } from './editorDrafts';
import { EditorDraftsContext } from './editorDraftsContext';
import { HistoryStore } from './history';
import { HistoryContext } from './historyContext';
import { MessageContext } from './messageContext';
import { MessageLog } from './messageLog';
import { ObservationContext } from './observationContext';
import { ObservationLog } from './observationLog';
import { PulseBus } from './pulses';
import { PulseContext } from './pulseContext';
import { StudioContext } from './studioContext';
import type { StudioStore } from './store';

/**
 * Gives the components of one window their store, their history, their pulse bus, their observation log, their message log,
 * the timeline editor's working copies and the guided demo's session. A history, a bus, a log, a set of copies or a session that is not
 * passed in is created (a test that does not draw a chart, a graph, the timeline, the Event stream, the editor or the demo need not
 * know about it).
 */
export function StudioProvider({
  store,
  history,
  pulses,
  observations,
  messages,
  drafts,
  demo,
  children,
}: {
  store: StudioStore;
  history?: HistoryStore;
  pulses?: PulseBus;
  observations?: ObservationLog;
  messages?: MessageLog;
  drafts?: EditorDrafts;
  demo?: DemoSessionStore;
  children: ReactNode;
}) {
  const [ownHistory] = useState(() => new HistoryStore());
  const [ownPulses] = useState(() => new PulseBus());
  const [ownObservations] = useState(() => new ObservationLog());
  const [ownMessages] = useState(() => new MessageLog());
  const [ownDrafts] = useState(() => new EditorDrafts());
  const [ownDemo] = useState(() => new DemoSessionStore());
  return (
    <StudioContext.Provider value={store}>
      <HistoryContext.Provider value={history ?? ownHistory}>
        <PulseContext.Provider value={pulses ?? ownPulses}>
          <ObservationContext.Provider value={observations ?? ownObservations}>
            <MessageContext.Provider value={messages ?? ownMessages}>
              <EditorDraftsContext.Provider value={drafts ?? ownDrafts}>
                <DemoSessionContext.Provider value={demo ?? ownDemo}>
                  {children}
                </DemoSessionContext.Provider>
              </EditorDraftsContext.Provider>
            </MessageContext.Provider>
          </ObservationContext.Provider>
        </PulseContext.Provider>
      </HistoryContext.Provider>
    </StudioContext.Provider>
  );
}

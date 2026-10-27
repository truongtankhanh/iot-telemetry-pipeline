import { type ReactNode, useState } from 'react';
import { BenchmarkContext } from './benchmarkContext';
import { BenchmarkStore } from './benchmarkStore';
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
import { SessionMetricsContext } from './sessionMetricsContext';
import { SessionMetricsStore } from './sessionMetricsStore';
import { StudioContext } from './studioContext';
import type { StudioStore } from './store';

/**
 * Gives the components of one window their store, their history, their pulse bus, their observation log, their message log,
 * the timeline editor's working copies, the guided demo's session, the benchmark and the session's metrics. A history, a bus, a log, a
 * set of copies, a session, a benchmark or a set of metrics that is not passed in is created (a test that does not draw a chart, a
 * graph, the timeline, the Event stream, the editor, the demo or the Analytics page need not know about it).
 */
export function StudioProvider({
  store,
  history,
  pulses,
  observations,
  messages,
  drafts,
  demo,
  benchmark,
  sessionMetrics,
  children,
}: {
  store: StudioStore;
  history?: HistoryStore;
  pulses?: PulseBus;
  observations?: ObservationLog;
  messages?: MessageLog;
  drafts?: EditorDrafts;
  demo?: DemoSessionStore;
  benchmark?: BenchmarkStore;
  sessionMetrics?: SessionMetricsStore;
  children: ReactNode;
}) {
  const [ownHistory] = useState(() => new HistoryStore());
  const [ownPulses] = useState(() => new PulseBus());
  const [ownObservations] = useState(() => new ObservationLog());
  const [ownMessages] = useState(() => new MessageLog());
  const [ownDrafts] = useState(() => new EditorDrafts());
  const [ownDemo] = useState(() => new DemoSessionStore());
  const [ownBenchmark] = useState(() => new BenchmarkStore());
  const [ownSessionMetrics] = useState(() => new SessionMetricsStore());
  return (
    <StudioContext.Provider value={store}>
      <HistoryContext.Provider value={history ?? ownHistory}>
        <PulseContext.Provider value={pulses ?? ownPulses}>
          <ObservationContext.Provider value={observations ?? ownObservations}>
            <MessageContext.Provider value={messages ?? ownMessages}>
              <EditorDraftsContext.Provider value={drafts ?? ownDrafts}>
                <DemoSessionContext.Provider value={demo ?? ownDemo}>
                  <BenchmarkContext.Provider value={benchmark ?? ownBenchmark}>
                    <SessionMetricsContext.Provider value={sessionMetrics ?? ownSessionMetrics}>
                      {children}
                    </SessionMetricsContext.Provider>
                  </BenchmarkContext.Provider>
                </DemoSessionContext.Provider>
              </EditorDraftsContext.Provider>
            </MessageContext.Provider>
          </ObservationContext.Provider>
        </PulseContext.Provider>
      </HistoryContext.Provider>
    </StudioContext.Provider>
  );
}

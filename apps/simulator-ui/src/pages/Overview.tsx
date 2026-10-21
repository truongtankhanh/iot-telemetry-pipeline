import { lazy, Suspense } from 'react';
import { dependencyNotes } from '../lib/dependencyNotes';
import { formatClockTime } from '../lib/time';
import { useNow } from '../state/useNow';
import { useStudio } from '../state/studioContext';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { PageHeader } from '../ui/PageHeader';
import { uiIcons } from '../ui/icons';
import { AlertFeed } from './overview/AlertFeed';
import { OverviewKpis } from './overview/OverviewKpis';
import { SimulationControls } from './overview/SimulationControls';
import { useOverviewKpis } from './overview/useOverviewKpis';
import { useOverviewParams } from './overview/useOverviewParams';
import { useSimulationControls } from './overview/useSimulationControls';
import { useRunElapsed } from './scenarios/useRunElapsed';
import styles from './overview/overview.module.css';
import pages from './pages.module.css';

// The compact topology is its own chunk, as the Topology is: it brings React Flow, which the rest of the Overview does
// not need, so the figures, the feed and the controls paint without waiting for it.
const OverviewTopology = lazy(() =>
  import('./overview/OverviewTopology').then((module) => ({ default: module.OverviewTopology })),
);

const DESCRIPTION =
  'Campus simulation environment. What is running, what it caused, and what to do next.';

/**
 * "server-room-overheat · 41 s in": the scenario that is playing. Its own component because it owns the timer of
 * `useRunElapsed`, which only a page that shows a running scenario needs.
 */
function RunningScenario({ name }: { name: string }) {
  const lengthS = useStudio((state) => {
    const run = state.view?.runs.find((r) => r.scenario === name);
    return run === undefined ? 0 : Math.max(0, run.endsAtS - run.offsetS);
  });
  const elapsed = useRunElapsed(name, lengthS);
  return (
    <Chip tone="warn" icon={uiIcons.play}>
      {name}
      {elapsed === null ? '' : ` · ${Math.floor(elapsed)} s in`}
    </Chip>
  );
}

/**
 * The Overview (frame 11), the page Studio opens on: what is running and what it caused. The key figures, the alerts
 * and the controls of the simulation are here; each figure comes from the source its own page reads. Before the first
 * message there is a loading line, with the link lost the last data stays, dimmed, and says when it was lost, and a
 * dependency that is down is told in a sentence above the figures.
 */
export function Overview() {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const lastAlertSink = useStudio((state) => state.lastAlertSink);
  const now = useNow();
  const kpis = useOverviewKpis(now);
  const controls = useSimulationControls();
  const [query, update] = useOverviewParams();

  const status =
    link === 'live' ? (
      <Chip tone="ok">Connected</Chip>
    ) : link === 'connecting' ? (
      <Chip>Connecting</Chip>
    ) : (
      <Chip tone="bad">Lost{lostSince === null ? '' : ` at ${formatClockTime(lostSince)}`}</Chip>
    );

  if (view === null || kpis === null) {
    return (
      <>
        <PageHeader title="Overview" description={DESCRIPTION}>
          {status}
        </PageHeader>
        <Card title="Simulation">
          <p role="status">
            {link === 'lost'
              ? 'The simulator has not answered yet.'
              : 'Waiting for the first message from the simulator…'}
          </p>
        </Card>
      </>
    );
  }

  const notes = dependencyNotes(view, lastAlertSink);
  const running = view.runs[0];
  const alertsUnknown = kpis.alerts.known ? null : kpis.alerts.reason;

  return (
    <div className={styles.page} data-stale={link === 'lost' ? 'true' : undefined}>
      <PageHeader title="Overview" description={DESCRIPTION}>
        {running === undefined ? null : <RunningScenario name={running.scenario} />}
        {status}
      </PageHeader>

      {notes.length === 0 ? null : (
        <ul className={pages.notes}>
          {notes.map((note) => (
            <li
              key={note.id}
              className={pages.note}
              data-tone={note.tone}
              role={note.tone === 'bad' ? 'alert' : 'status'}
            >
              <div className={pages.noteTitle}>{note.title}</div>
              <div className={pages.noteText}>{note.text}</div>
            </li>
          ))}
        </ul>
      )}

      <OverviewKpis kpis={kpis} />

      <div className={styles.cols}>
        <Suspense
          fallback={
            <Card title="Live topology">
              <p role="status">Loading the topology…</p>
            </Card>
          }
        >
          <OverviewTopology now={now} query={query} onQuery={update} />
        </Suspense>
        <div className={styles.col}>
          <AlertFeed alerts={view.alerts.alerts} unknownReason={alertsUnknown} />
          <SimulationControls
            controls={controls}
            scenario={query.scenario}
            onScenario={(scenario) => update({ scenario })}
          />
        </div>
      </div>
    </div>
  );
}

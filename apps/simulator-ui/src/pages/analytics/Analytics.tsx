import { useState } from 'react';
import {
  checkMessages,
  DEFAULT_MESSAGES,
  defaultMessages,
  expectedReadingsFor,
} from '../../lib/benchmarkStart';
import { useBenchmark } from '../../state/benchmarkContext';
import { useSessionMetrics } from '../../state/sessionMetricsContext';
import { useStudio } from '../../state/studioContext';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { uiIcons } from '../../ui/icons';
import { PageHeader } from '../../ui/PageHeader';
import styles from './analytics.module.css';
import { ChartsSection } from './ChartsSection';
import { ResultsCard } from './ResultsCard';
import { RunPanel } from './RunPanel';
import { SettingsCard } from './SettingsCard';
import { StartDialog } from './StartDialog';
import { useBenchmarkChecks } from './useBenchmarkChecks';
import { useBenchmarkCommands } from './useBenchmarkCommands';

const DESCRIPTION =
  'Session metrics from ingest, and the benchmark: it publishes as fast as the broker accepts, then waits until every reading is in PostgreSQL. Method and past results: docs/benchmarks.md.';

/**
 * Analytics (frame 09): what ingest has done since this window opened, and the benchmark. The benchmark belongs to the simulator, not to
 * this page: closing the tab leaves it running, and a page opened in the middle of a run shows it and can stop it. The page asks before it
 * starts one (a heavy run saturates the broker and the CPU and writes to the live database), says why Start is off, and gives Stop at every
 * moment of a run. With a run going it shows the run; with a finished one chosen in the results, that run; otherwise the session's charts.
 * The settings are the simulator's: the size is the only one it takes.
 */
export function Analytics() {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const benchmark = useBenchmark();
  const session = useSessionMetrics();
  const commands = useBenchmarkCommands();

  const summary = view?.benchmark ?? null;
  const available = summary?.available === true;
  const running = benchmark.status !== null;
  // What the checks depend on: the devices that run, the scenarios that play, ingest's status. When it changes the list is read again.
  const watch =
    view === null
      ? ''
      : [
          view.engine.devices
            .filter((device) => device.state === 'running')
            .map((device) => device.id)
            .join(','),
          view.runs.length,
          view.ingest.status,
        ].join('|');
  const checks = useBenchmarkChecks({ enabled: available && !running, watch });

  const [typed, setTyped] = useState<number | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [shownId, setShownId] = useState<number | null>(null);

  if (view === null || summary === null) {
    return (
      <>
        <PageHeader title="Analytics" description={DESCRIPTION} />
        <p role="status">Waiting for the simulator…</p>
      </>
    );
  }

  const messages =
    typed === undefined ? defaultMessages(summary.maxMessages || DEFAULT_MESSAGES) : typed;
  const size = checkMessages(messages, summary.maxMessages);
  // A run going is shown; otherwise the finished run the person chose, if the simulator still has it.
  const shown = running
    ? benchmark.current
    : (benchmark.runs.find((run) => run.id === shownId) ?? null);
  // The checks a refused start named are the ones to read, until the person asks again.
  const items = commands.refused ?? checks.checks;

  const refresh = () => {
    commands.clearError();
    checks.refresh();
  };

  const confirm = async () => {
    if (!size.ok) {
      setConfirming(false);
      return;
    }
    await commands.start(size.messages);
    setConfirming(false);
    setShownId(null);
  };

  return (
    <>
      <PageHeader title="Analytics" description={DESCRIPTION}>
        {running ? (
          <Button
            variant="danger"
            icon={uiIcons.stop}
            disabled={commands.stopping}
            aria-busy={commands.stopping || undefined}
            onClick={() => void commands.stop()}
          >
            {commands.stopping ? 'Stopping…' : 'Stop run'}
          </Button>
        ) : null}
      </PageHeader>

      {running ? (
        <Banner tone="warn">
          <b>Heavy run.</b> This uses most of this machine’s CPU and memory while it lasts. The
          controls that publish are locked until it ends. Stop ends it at any time; what was already
          published stays published and stored.
        </Banner>
      ) : available ? (
        <Banner tone="info">
          A benchmark saturates the broker and the CPU and writes its readings to PostgreSQL. The
          fleet must be paused to start one.
        </Banner>
      ) : (
        <Banner tone="warn">
          The benchmark is not available: {summary.reason ?? 'not configured'}. The charts of this
          session still work. Set <code>DATABASE_URL</code> for the simulator to run one
          (apps/simulator/.env.example).
        </Banner>
      )}
      {running && link === 'lost' ? (
        <Banner tone="warn">
          The link to the simulator is lost. The run goes on: it belongs to the simulator and not to
          this page. Stop works once the link is back.
        </Banner>
      ) : null}
      {commands.error === null ? null : (
        <div className={styles.alert} role="alert">
          {commands.error}
        </div>
      )}
      {!running && shown !== null ? (
        <Banner tone="info">
          Showing run {shown.id} from this session, not the live charts.{' '}
          <Button variant="ghost" size="sm" onClick={() => setShownId(null)}>
            Show the session
          </Button>
        </Banner>
      ) : null}

      <div className={styles.cols} data-single={available ? undefined : 'true'}>
        {available ? (
          <div className={styles.side}>
            <SettingsCard
              summary={summary}
              deviceCount={view.devices.length}
              running={running}
              messages={messages}
              onMessages={setTyped}
              checks={{
                items,
                loading: checks.loading,
                error: checks.error,
                onRefresh: refresh,
              }}
              starting={commands.starting}
              onStart={() => setConfirming(true)}
            />
          </div>
        ) : null}
        <div className={styles.main}>
          {shown !== null ? <RunPanel run={shown} /> : null}
          <ChartsSection run={shown} session={session.points} />
          <ResultsCard
            runs={benchmark.runs}
            database={summary.database}
            shownId={running ? null : shownId}
            onShow={setShownId}
          />
        </div>
      </div>

      {confirming && size.ok ? (
        <StartDialog
          messages={size.messages}
          readings={expectedReadingsFor(size.messages, view.devices)}
          database={summary.database}
          busy={commands.starting}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

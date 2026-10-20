import { dependencyNotes } from '../lib/dependencyNotes';
import { formatClockTime } from '../lib/time';
import { usePills } from '../shell/usePills';
import { useStudio } from '../state/studioContext';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { PageHeader } from '../ui/PageHeader';
import { Pill } from '../ui/Pill';
import styles from './pages.module.css';

/**
 * The Overview of this ticket: the shell with one real card, the connection. It proves the stream works
 * and that the pills in the header are not decoration; the KPIs, the live topology, the alert feed, the
 * controls and the timeline arrive with SIM-09.
 */
export function Overview() {
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const lastDataAt = useStudio((state) => state.lastDataAt);
  const lastAlertSink = useStudio((state) => state.lastAlertSink);
  const publishRate = useStudio((state) => state.publishRate);
  const view = useStudio((state) => state.view);
  const pills = usePills();
  const notes = dependencyNotes(view, lastAlertSink);

  const devices = view?.engine.devices ?? [];
  const running = devices.filter((device) => device.state === 'running').length;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Health of the simulated campus: the pipeline from device to incident."
      >
        {link === 'live' ? <Chip tone="ok">Connected</Chip> : null}
        {link === 'connecting' ? <Chip>Connecting</Chip> : null}
        {link === 'lost' ? (
          <Chip tone="bad">
            Lost{lostSince === null ? '' : ` at ${formatClockTime(lostSince)}`}
          </Chip>
        ) : null}
      </PageHeader>

      <div className={styles.cards}>
        <Card title="Connection">
          <div className={styles.row}>
            {pills.map((pill) => (
              <Pill
                key={pill.id}
                label={pill.label}
                detail={pill.detail}
                tone={pill.tone}
                stale={pill.stale}
              />
            ))}
          </div>

          {view === null ? (
            <p className={styles.muted}>
              {link === 'lost'
                ? 'The simulator has not answered yet.'
                : 'Waiting for the first message from the simulator…'}
            </p>
          ) : notes.length === 0 ? (
            <p className={styles.muted}>
              The broker, ingest and the command center are all answering.
            </p>
          ) : (
            <ul className={styles.notes}>
              {notes.map((note) => (
                <li key={note.id} className={styles.note} data-tone={note.tone}>
                  <div className={styles.noteTitle}>{note.title}</div>
                  <div className={styles.noteText}>{note.text}</div>
                </li>
              ))}
            </ul>
          )}

          {view !== null ? (
            <dl className={styles.facts}>
              <dt>Engine</dt>
              <dd>
                {view.engine.running ? 'running' : 'stopped'} · {running} of {devices.length}{' '}
                devices · {publishRate.toFixed(1)} msg/s
              </dd>
              <dt>Clock</dt>
              <dd>{view.config.simulated ? 'simulated (moves when stepped)' : 'wall clock'}</dd>
              <dt>Interval</dt>
              <dd>{view.config.intervalMs} ms per device</dd>
              <dt>Last data</dt>
              <dd>{lastDataAt === null ? '—' : formatClockTime(lastDataAt)}</dd>
            </dl>
          ) : null}

          {view !== null && view.scenarios.length > 0 ? (
            <div className={styles.row}>
              <span className={styles.muted}>Scenarios</span>
              {view.scenarios.map((name) => (
                <Chip key={name} tone="accent">
                  {name}
                </Chip>
              ))}
            </div>
          ) : null}
        </Card>

        <Card title="The rest of the Overview">
          <p>
            The KPIs, the live topology, the alert feed, the simulation controls and the event
            timeline arrive with <b>SIM-09</b>. Until then this page shows the one thing every other
            page depends on: whether Studio is talking to the simulator, and whether the simulator
            is talking to the pipeline.
          </p>
          <p className={styles.muted}>
            Search anything with the box in the header, or press <b>/</b>; go to a page with{' '}
            <b>g</b> and a letter.
          </p>
        </Card>
      </div>
    </>
  );
}

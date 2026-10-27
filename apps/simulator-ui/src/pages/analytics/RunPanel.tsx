import type { BenchmarkRunDetail } from '../../api/types';
import { runFigures } from '../../lib/benchmarkSeries';
import { formatCount, formatSeconds, OUTCOMES } from '../../lib/benchmarkRows';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { toneIcons } from '../../ui/icons';
import { Progress } from '../../ui/Progress';
import styles from './analytics.module.css';
import { Stat } from './Stat';

const PHASE_TITLES = {
  starting: 'starting',
  publishing: 'publishing',
  waiting: 'waiting for the readings to be stored',
  ended: 'ended',
} as const;

const oneDecimal = (value: number) => (Math.round(value * 10) / 10).toString();
const twoDecimals = (value: number) => (Math.round(value * 100) / 100).toString();

/** The line under the stored bar: what is still on its way while the run goes, what never arrived when it has ended. */
function storedNote(inFlight: number | null, ended: boolean): string {
  if (inFlight === null)
    return ended ? 'The stored count is not known.' : 'The stored count is not known yet.';
  if (!ended) return `${formatCount(inFlight)} readings still in flight or buffered`;
  return inFlight === 0
    ? 'Every reading was stored.'
    : `${formatCount(inFlight)} readings were never stored.`;
}

export interface RunPanelProps {
  /** The run going now, or the finished one the person chose to look at. */
  run: BenchmarkRunDetail;
}

/**
 * Where a run has got (frame 09): published and stored each out of its own total and in its own unit (messages and readings are
 * different things, and a bar that mixed them would never meet), and the figures of the last second. The rates of a run that
 * completed are the command line's own; during a run the queue delay is an estimate (ingest's own lag cannot be read on a benchmark
 * run, whose readings are stamped an hour in the past) and is named as one.
 */
export function RunPanel({ run }: RunPanelProps) {
  const figures = runFigures(run);
  const ended = run.phase === 'ended';
  const outcome = run.outcome === null ? null : OUTCOMES[run.outcome];
  const rate = (value: number | null) => (value === null ? null : formatCount(value));

  return (
    <Card
      title={`Run ${run.id}`}
      aside={
        outcome ? (
          <Chip tone={outcome.tone} icon={toneIcons[outcome.tone]}>
            {outcome.word}
          </Chip>
        ) : (
          <Chip tone="accent">{PHASE_TITLES[run.phase]}</Chip>
        )
      }
    >
      {ended && run.reason !== null ? (
        <p className={styles.reason} role="status">
          {run.reason}
        </p>
      ) : null}
      <div className={styles.progressPair}>
        <Progress
          label="Published"
          value={run.published}
          max={run.settings.messages}
          unit="messages"
        />
        <Progress
          label="Stored in PostgreSQL"
          value={run.stored}
          max={run.expectedReadings}
          unit="readings"
          tone="secondary"
          note={storedNote(figures.inFlight, ended)}
        />
      </div>
      <dl className={styles.stats}>
        <Stat
          label="Publish rate"
          value={rate(figures.messagesPerS.value)}
          unit="messages/s"
          note={
            figures.messagesPerS.basis === 'now'
              ? `elapsed ${formatSeconds(run.elapsedMs / 1000)}`
              : `end to end, ${formatSeconds(run.elapsedMs / 1000)}`
          }
        />
        <Stat
          label="Stored rate"
          value={rate(figures.storedPerS.value)}
          unit="readings/s"
          note={figures.storedPerS.basis === 'now' ? 'last second' : 'end to end'}
        />
        <Stat
          label="Queue delay (estimated)"
          value={figures.queueDelayS === null ? null : twoDecimals(figures.queueDelayS)}
          unit="s"
          note="readings in flight ÷ stored rate"
        />
        <Stat
          label="Flush time p95"
          value={figures.flushP95S === null ? null : oneDecimal(figures.flushP95S * 1000)}
          unit="ms"
          note={<span className={styles.metric}>telemetry_flush_duration_seconds</span>}
        />
      </dl>
    </Card>
  );
}

import { Link } from 'react-router';
import { PHASE_WORDS } from '../lib/benchmarkLock';
import { formatClockTime } from '../lib/time';
import { useBenchmarkStatus } from '../state/benchmarkContext';
import { useStudio } from '../state/studioContext';
import { Pill } from '../ui/Pill';
import styles from './header.module.css';
import { usePills } from './usePills';

function useStaleTitle(): (stale: boolean) => string | undefined {
  const lastDataAt = useStudio((state) => state.lastDataAt);
  return (stale) =>
    stale
      ? `Last known value${lastDataAt === null ? '' : `, from ${formatClockTime(lastDataAt)}`}`
      : undefined;
}

/**
 * Broker, Ingest and Command Center: what the pipeline depends on. Each is drawn from what the simulator
 * last said, dimmed and dashed when that is old, and says why in words ("unreachable", "not configured").
 */
export function DependencyPills() {
  const pills = usePills().filter((pill) => pill.id !== 'running' && pill.id !== 'faults');
  const titleFor = useStaleTitle();
  return (
    <div className={styles.env} role="group" aria-label="Dependencies">
      {pills.map((pill) => (
        <Pill
          key={pill.id}
          label={pill.label}
          detail={pill.detail}
          tone={pill.tone}
          stale={pill.stale}
          title={titleFor(pill.stale)}
        />
      ))}
    </div>
  );
}

/** The engine: running or paused, how many devices, how many messages a second. */
export function EnginePill() {
  const pill = usePills().find((p) => p.id === 'running');
  const titleFor = useStaleTitle();
  if (!pill) return null;
  return (
    <Pill
      label={pill.label}
      detail={pill.detail}
      tone={pill.tone}
      stale={pill.stale}
      title={titleFor(pill.stale)}
    />
  );
}

/**
 * "Faults on · n active", while the engine has a fault on: a link to the Faults page, on every page, so that nobody forgets
 * that the readings in the database may differ from what the devices intended. Nothing is drawn when no fault is on.
 */
export function FaultsPill() {
  const pill = usePills().find((p) => p.id === 'faults');
  const titleFor = useStaleTitle();
  if (!pill) return null;
  return (
    <Link
      to="/lab/faults"
      className={styles.pillLink}
      title={titleFor(pill.stale) ?? 'Open the Faults page'}
    >
      <Pill label={pill.label} detail={pill.detail} tone={pill.tone} stale={pill.stale} />
    </Link>
  );
}

/**
 * "Benchmark running · run 3 · publishing", while a benchmark runs: a link to Analytics, on every page and in the presenter's
 * header, because a run saturates the broker and the CPU and writes to the live database, and nobody should find that out from a slow
 * machine. It follows the run's phase and not each point of its series. Nothing is drawn when no run goes.
 */
export function BenchmarkPill() {
  const status = useBenchmarkStatus();
  if (status === null) return null;
  return (
    <Link
      to="/analytics"
      className={styles.pillLink}
      title="A benchmark is running. Open Analytics to follow it or stop it"
    >
      <Pill
        label="Benchmark running"
        detail={`run ${status.id} · ${PHASE_WORDS[status.phase]}`}
        tone="warn"
      />
    </Link>
  );
}

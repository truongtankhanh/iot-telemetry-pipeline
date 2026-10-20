import { formatClockTime } from '../lib/time';
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
  const pills = usePills().filter((pill) => pill.id !== 'running');
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

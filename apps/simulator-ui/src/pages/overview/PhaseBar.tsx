import type { PhaseModel } from '../../lib/scenarioPhases';
import styles from './overview.module.css';

type Available = Extract<PhaseModel, { available: true }>;

export interface PhaseBarProps {
  model: Available;
}

/** How much of a phase has been played, in percent: none before it, all after it. */
function playedPct(elapsedS: number | null, fromS: number, toS: number): number {
  if (elapsedS === null || toS <= fromS) return 0;
  return Math.min(Math.max((elapsedS - fromS) / (toS - fromS), 0), 1) * 100;
}

/**
 * A scenario as three named phases on one bar (frame 11): the part already played is solid and the rest dim, the
 * alert-opened flag is filled once the alert has opened and hollow before (the clear flag the same), the playhead
 * carries its time, and two plain lines say what has happened and what comes next. The picture is one `img` named by
 * a sentence that carries every number; the words under it are the same facts in text. Everything comes from the model.
 */
export function PhaseBar({ model }: PhaseBarProps) {
  const { segments, flags, elapsedS, playheadPct, playheadText, happened, next, description } =
    model;
  return (
    <div
      className={styles.phase}
      role="group"
      aria-label="Scenario progress: normal, anomaly, recovery"
    >
      <div className={styles.phaseBar} role="img" aria-label={description}>
        {segments.map((segment) => (
          <span
            key={segment.id}
            className={styles.phaseSegment}
            data-phase={segment.id}
            style={{ left: `${segment.leftPct}%`, width: `${segment.widthPct}%` }}
          >
            <i style={{ width: `${playedPct(elapsedS, segment.fromS, segment.toS)}%` }} />
          </span>
        ))}
        {flags.map((flag) => (
          <span
            key={`${flag.kind}:${flag.title}`}
            className={styles.phaseFlag}
            data-kind={flag.kind}
            data-done={flag.done ? 'true' : undefined}
            data-uncertain={flag.uncertain ? 'true' : undefined}
            style={{ left: `${flag.leftPct}%` }}
            title={flag.text}
          />
        ))}
        {playheadPct === null ? null : (
          <span className={styles.phasePlayhead} style={{ left: `${playheadPct}%` }}>
            <span className={styles.phasePill}>{playheadText}</span>
          </span>
        )}
      </div>

      <div
        className={styles.phaseLabels}
        aria-hidden="true"
        style={{
          gridTemplateColumns: segments
            .map((segment) => `minmax(max-content, ${segment.widthPct}fr)`)
            .join(' '),
        }}
      >
        {segments.map((segment) => (
          <span key={segment.id} data-phase={segment.id}>
            <b>{segment.label}</b>
            {segment.detail}
          </span>
        ))}
      </div>

      <p className={styles.phaseSummary}>
        <span>{happened}</span>
        <span>{next}</span>
      </p>
    </div>
  );
}

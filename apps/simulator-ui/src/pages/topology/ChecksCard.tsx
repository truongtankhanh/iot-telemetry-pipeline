import { formatClockTime } from '../../lib/time';
import type { StageChecks } from '../../lib/topologyDetail';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { toneIcons } from '../../ui/icons';
import styles from './detail.module.css';

export interface ChecksCardProps {
  checks: StageChecks;
}

const CHIP_TONES = { ok: 'ok', warn: 'warn', bad: 'bad', unknown: 'neutral' } as const;

/**
 * What Studio asked each dependency and what came back (frame 10): the broker, ingest and the alert sink, each as an
 * icon, a word and a sentence with the exact request or address in it. Shown when something is wrong, so a demo that
 * does not behave explains itself in a sentence and not in a stack trace.
 */
export function ChecksCard({ checks }: ChecksCardProps) {
  return (
    <Card
      title="Checks"
      aside={
        <span className={styles.muted}>
          {checks.lastRunAt === null
            ? 'not run yet'
            : `last run ${formatClockTime(checks.lastRunAt)}`}
        </span>
      }
    >
      <ul className={styles.checks} aria-label="Checks of the dependencies">
        {checks.checks.map((check) => (
          <li key={check.id} className={styles.check}>
            <Icon glyph={toneIcons[check.tone]} />
            <div className={styles.checkText}>
              <b>{check.label}</b>
              <span className={styles.muted}>{check.text}</span>
            </div>
            <Chip tone={CHIP_TONES[check.tone]}>{check.chip}</Chip>
          </li>
        ))}
      </ul>
    </Card>
  );
}

import { type AlertTrail as Trail } from '../../lib/alertTrail';
import { formatClockTime, isoTime } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { trailGlyphs } from '../../ui/icons';
import styles from './alerts.module.css';

export interface AlertTrailProps {
  trail: Trail;
}

/**
 * The path of an alert from the first breaching reading to the incident, as an ordered list (frame 13). Each step has
 * its words (a state is its title: "Outbox pending", "Outbox delivery failed", not a colour), its time and whose
 * clock that is (ingest's, a recorded reading's, or Studio's own first sight), so the two kinds of time in one list
 * are never mistaken for one. A step Studio cannot honestly give is not drawn; the notes under the list say why.
 */
export function AlertTrail({ trail }: AlertTrailProps) {
  return (
    <>
      <ol className={styles.trail} aria-label="Delivery trail">
        {trail.steps.map((step) => (
          <li key={step.id} className={styles.step} data-step={step.id} data-tone={step.tone}>
            <span className={styles.mark} data-tone={step.tone} aria-hidden="true">
              <Icon glyph={trailGlyphs[step.glyph]} size="sm" />
            </span>
            <div className={styles.stepBody}>
              <span className={styles.stepTitle}>{step.title}</span>
              <span className={`${styles.stepDetail} ${step.mono ? styles.mono : ''}`}>
                {step.detail}
              </span>
            </div>
            <span className={styles.stepTime}>
              {step.time === null ? (
                step.tone === 'ok' ? (
                  <span>time not known</span>
                ) : null
              ) : (
                <>
                  <time dateTime={isoTime(step.time)}>{formatClockTime(step.time)}</time>
                  <span>{step.provenance}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className={styles.trailNotes}>
        {trail.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </>
  );
}

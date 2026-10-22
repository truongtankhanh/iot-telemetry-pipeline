import { impactView } from '../../lib/labImpact';
import { Chip } from '../../ui/Chip';
import { stageGlyphs, uiIcons } from '../../ui/icons';
import type { ExpectedImpact } from './useExpectedImpact';
import styles from './labCanvas.module.css';

export interface ImpactStripProps {
  impact: ExpectedImpact;
  /** Where ingest delivers alerts (`StateView.ingest.alertSink`): the strip does not promise an incident without a sink. */
  sink: string | null;
}

const ICONS = {
  rule: stageGlyphs.rules,
  alert: stageGlyphs.alert,
  incident: stageGlyphs.commandCenter,
  clear: uiIcons.check,
} as const;

/**
 * What the rules should do with the fault being configured (frames 12 and 19): the rule, the alert and about when, the
 * incident, when it clears. The numbers are the simulator's (`POST /api/expectations`), worked out from `rules.json`
 * and the publish interval, and the strip says so; it says what it cannot promise (a device that is not running, a signal no
 * rule watches, a command center that is not configured) in words under the chips. While a new answer is on its way the
 * last one stays, dimmed.
 */
export function ImpactStrip({ impact, sink }: ImpactStripProps) {
  const view = impactView({
    status: impact.status,
    preview: impact.preview,
    error: impact.error,
    sink,
  });
  const stale = impact.preview !== null && !impact.fresh && impact.status !== 'error';
  return (
    <section
      className={styles.impact}
      aria-label="Expected impact"
      aria-busy={impact.status === 'loading'}
      data-stale={stale ? 'true' : undefined}
    >
      <div className={styles.impactRow}>
        <h3 className={styles.impactTitle}>Expected impact</h3>
        {view.kind === 'message' ? (
          <p className={styles.impactMessage} role={impact.status === 'error' ? 'alert' : 'status'}>
            {view.message}
          </p>
        ) : (
          view.chips.map((chip) => (
            <Chip
              key={chip.id}
              tone={chip.tone === 'warn' ? 'warn' : chip.tone === 'ok' ? 'ok' : 'neutral'}
              icon={ICONS[chip.id]}
            >
              {chip.text}
            </Chip>
          ))
        )}
      </div>
      {view.notes.length > 0 ? (
        <ul className={styles.impactNotes}>
          {view.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

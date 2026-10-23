import { Fragment } from 'react';
import type { DemoStage, DemoStageId } from '../../lib/demoPipeline';
import { Icon } from '../../ui/Icon';
import { type Glyph, stageGlyphs, trailGlyphs } from '../../ui/icons';
import styles from './demo.module.css';

const GLYPHS: Record<DemoStageId, Glyph> = {
  device: trailGlyphs.reading,
  ingest: stageGlyphs.ingest,
  rule: stageGlyphs.rules,
  alert: stageGlyphs.alert,
  commandCenter: stageGlyphs.commandCenter,
};

export interface PipelineStripProps {
  stages: readonly DemoStage[];
}

/**
 * The pipeline so far (frame 08): the device, ingest, the rule, the alert and the Command Center, each with its figure and a line
 * in words ("counting", "not yet"), lit as the chain reaches it. What a stage is, is said in its caption: the colour only agrees.
 */
export function PipelineStrip({ stages }: PipelineStripProps) {
  return (
    <section aria-label="Pipeline so far">
      <ol className={styles.strip} role="list">
        {stages.map((stage, index) => (
          <Fragment key={stage.id}>
            <li className={styles.stage} data-state={stage.state} data-dimmed={stage.dimmed}>
              <span className={styles.stageHead}>
                <Icon glyph={GLYPHS[stage.id]} size="sm" />
                {stage.label}
              </span>
              <span className={styles.stageValue}>
                {stage.value}
                {stage.unit === null ? null : <small>{stage.unit}</small>}
              </span>
              <span className={styles.stageCaption}>{stage.caption}</span>
            </li>
            {index < stages.length - 1 ? (
              <li
                className={styles.link}
                aria-hidden="true"
                data-idle={stages[index + 1]?.state === 'idle'}
              />
            ) : null}
          </Fragment>
        ))}
      </ol>
    </section>
  );
}

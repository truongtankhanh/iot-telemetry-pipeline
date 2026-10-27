import { useEffect } from 'react';
import { stepStanding } from '../../lib/demoSession';
import { scriptLine } from '../../lib/demoText';
import { Kbd } from '../../ui/Kbd';
import styles from './demo.module.css';
import { PipelineStrip } from './PipelineStrip';
import { PresenterStepCard } from './PresenterStepCard';
import { StepList } from './StepList';
import type { DemoDriver } from './useDemoDriver';

export interface PresenterViewProps {
  driver: DemoDriver;
}

/**
 * The presenter view (frame 08): the steps on the left; on the right the current step, the pipeline so far and the keys. The
 * navigation is not here (the shell leaves it out while presenting). Focus goes to the primary button when the view appears, so a
 * presenter who started from the keyboard can go on from it; it does not move when a step moves on by itself. The current step is
 * `PresenterStepCard`, which the twin's dock draws too.
 */
export function PresenterView({ driver }: PresenterViewProps) {
  const { script, session, step, text, live } = driver;

  useEffect(() => {
    document.querySelector<HTMLElement>('button[aria-keyshortcuts="Space"]')?.focus();
  }, []);

  if (step === undefined) return null;

  return (
    <div className={styles.pres}>
      <StepList
        items={script.steps.map((entry, index) => ({
          id: entry.id,
          title: text(entry.title),
          summary: text(entry.summary),
          standing: stepStanding(session, index),
        }))}
        scriptLine={scriptLine(script, live.scenarioItem)}
      />
      <div className={styles.main}>
        <PresenterStepCard driver={driver} />
        <PipelineStrip stages={driver.stages} />
        <div className={styles.keys}>
          <span>
            <Kbd>Space</Kbd> next
          </span>
          <span>
            <Kbd>←</Kbd> back
          </span>
          <span>
            <Kbd>P</Kbd> {driver.devicesPaused ? 'resume devices' : 'pause devices'}
          </span>
          <span>
            <Kbd>R</Kbd> restart
          </span>
          {step.notes === undefined ? null : (
            <span>
              <Kbd>N</Kbd> presenter notes
            </span>
          )}
          <span>
            <Kbd>Esc</Kbd> exit
          </span>
        </div>
      </div>
    </div>
  );
}

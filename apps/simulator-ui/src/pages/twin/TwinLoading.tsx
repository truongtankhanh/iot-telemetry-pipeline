import { loadingSteps, type LoadingStep } from '../../lib/twinStatus';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import styles from './twinStage.module.css';

function Mark({ state }: { state: LoadingStep['state'] }) {
  if (state === 'done') return <Icon glyph={uiIcons.check} size="sm" className={styles.stepDone} />;
  return (
    <span
      className={state === 'loading' ? styles.spinner : styles.hollow}
      data-animated={state === 'loading' ? 'true' : undefined}
      aria-hidden="true"
    />
  );
}

export interface TwinLoadingProps {
  /** Zones in the layout, and devices it places: what is already here. */
  zones: number;
  devices: number;
}

/**
 * The card over the flat plan while the 3D code loads (frame 16): what is ready, what is on its way, and a line that says
 * the devices already report on the plan. Each step says its state in a word as well as in its mark. There is no
 * percentage: loading a chunk reports no progress, and a bar that moved would be made up; the bar only says "working", and
 * stands still under reduced motion.
 */
export function TwinLoading({ zones, devices }: TwinLoadingProps) {
  const steps = loadingSteps({ zones, devices });
  return (
    <section
      className={styles.loadingCard}
      role="status"
      aria-busy="true"
      aria-label="Preparing the 3D view"
    >
      <h3 className={styles.loadingTitle}>Preparing the 3D view</h3>
      <ul className={styles.steps}>
        {steps.map((step) => (
          <li key={step.id} className={styles.step} data-state={step.state}>
            <Mark state={step.state} />
            <span>{step.label}</span>
            <span className={styles.stepWord}>{step.word}</span>
          </li>
        ))}
      </ul>
      <div className={styles.bar} data-animated="true" aria-hidden="true" />
      <p className={styles.loadingNote}>
        Devices already report on the flat plan. Nothing waits for the 3D code.
      </p>
    </section>
  );
}

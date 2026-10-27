import { DEMO_SCRIPTS } from '../../lib/demoScripts';
import type { DemoScript } from '../../lib/demoScript';
import { useDemoSession } from '../../state/demoSessionContext';
import { Kbd } from '../../ui/Kbd';
import { PresenterStepCard } from '../demo/PresenterStepCard';
import { useDemoDriver } from '../demo/useDemoDriver';
import { useDemoKeys } from '../demo/useDemoKeys';
import { ReplaceDialog } from '../scenarios/ReplaceDialog';
import styles from './twin.module.css';

export interface TwinPresenterDockProps {
  /** Why the step's camera moved nothing (it names a building this layout lacks), or `null`. */
  problem: string | null;
}

function Dock({ script, problem }: { script: DemoScript; problem: string | null }) {
  const driver = useDemoDriver(script);
  const { actions } = driver;

  useDemoKeys(true, {
    next: actions.next,
    back: actions.back,
    exit: actions.exit,
    restart: () => void actions.restart(),
    togglePause: () => void actions.togglePause(),
    toggleNotes: actions.toggleNotes,
  });

  return (
    <section className={styles.dock} aria-label="Guided demo">
      <PresenterStepCard driver={driver} compact />
      {problem === null ? null : (
        <p className={styles.dockProblem} role="status">
          {problem}
        </p>
      )}
      <p className={styles.dockKeys}>
        <span>
          <Kbd>Space</Kbd> next
        </span>
        <span>
          <Kbd>←</Kbd> back
        </span>
        <span>
          <Kbd>R</Kbd> restart
        </span>
        <span>
          <Kbd>Esc</Kbd> exit
        </span>
      </p>
      {driver.pendingReplace === null ? null : (
        <ReplaceDialog
          pending={driver.pendingReplace}
          busy={driver.replaceBusy}
          onConfirm={() => void actions.confirmReplace()}
          onCancel={actions.cancelReplace}
        />
      )}
    </section>
  );
}

/**
 * The guided demo's presenter, on the twin (SIM-21; frame 08's card beside the scene): while a demo is being presented the twin
 * page draws the current step compactly above the selection, and the camera moves when a step that names one comes on screen
 * (`useTwinDemoCamera`). It is the Demo page's own driver and keys (`useDemoDriver`, `useDemoKeys`), so a step is entered,
 * matched and moved on by itself exactly as there, and the two are never mounted together (they are different routes). `Esc`
 * leaves presenter mode and does not climb a level, and `←` goes back a step and does not pan (`createTwinShortcuts`); the
 * level above is reached with the breadcrumb. The pipeline strip of the Demo page is not drawn here: the scene shows the pipeline
 * as its hub and arcs, and a strip would not fit a column this narrow. Nothing is drawn when no demo is being presented.
 */
export function TwinPresenterDock({ problem }: TwinPresenterDockProps) {
  const session = useDemoSession();
  const script = DEMO_SCRIPTS.find((entry) => entry.id === session.scriptId);
  if (session.status !== 'presenting' || script === undefined) return null;
  return <Dock script={script} problem={problem} />;
}

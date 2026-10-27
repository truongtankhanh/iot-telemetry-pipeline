import { type ReactNode, useCallback, useState } from 'react';
import type { FallbackReason, SceneProblem } from '../../lib/twinStatus';
import { webgl2Available } from '../../lib/webgl';
import { PageHeader } from '../../ui/PageHeader';
import { ViewSwitch } from '../../ui/ViewSwitch';
import styles from './twin.module.css';
import { TwinCampus } from './TwinCampus';
import { TwinFallback } from './TwinFallback';
import { TwinPresenterDock } from './TwinPresenterDock';
import { useTwinLayout } from './useTwinLayout';

/**
 * What the page shows where the campus is not drawn (loading, a failed read, a layout that cannot be used, no WebGL 2, a lost
 * graphics context), with the guided demo's current step under it while a demo is being presented: presenter mode takes the navigation
 * away on this page (SIM-21), so the way on must not depend on the scene. The campus draws the dock itself, beside its scene.
 */
function WithDock({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <TwinPresenterDock problem={null} />
    </>
  );
}

/**
 * The page once the device can draw it: reads the layout from the simulator and decides what `/twin` is — the campus, or
 * the fallback with the reason (a failed read, a layout the simulator could not use, a scene that lost its graphics
 * context or whose code did not load). It never shows an empty canvas.
 */
function TwinStage() {
  const layout = useTwinLayout();
  const [problem, setProblem] = useState<SceneProblem | null>(null);
  const onUnavailable = useCallback((next: SceneProblem) => setProblem(next), []);

  if (layout.status === 'loading') {
    return (
      <WithDock>
        <p role="status" className={styles.status}>
          Reading the campus layout…
        </p>
      </WithDock>
    );
  }
  if (layout.status === 'error') {
    const reason: FallbackReason = { kind: 'layout-error', message: layout.error ?? '' };
    return (
      <WithDock>
        <TwinFallback reason={reason} onRetry={layout.retry} />
      </WithDock>
    );
  }

  const view = layout.view;
  if (view === null || !view.available || view.layout === null) {
    return (
      <WithDock>
        <TwinFallback reason={{ kind: 'layout-unavailable', reason: view?.reason ?? null }} />
      </WithDock>
    );
  }
  if (problem !== null) {
    return (
      <WithDock>
        <TwinFallback reason={{ kind: problem }} />
      </WithDock>
    );
  }

  return <TwinCampus view={view} onUnavailable={onUnavailable} />;
}

/**
 * The digital twin (frames 14 and 16): the simulated campus in 3D, with a pin for every device in the state Fleet and
 * Topology give it. The device is asked first whether it can create a WebGL 2 context; if not, nothing is requested and the
 * page shows why, with the Topology in place, which has every value. Otherwise the layout is read from the simulator, the
 * flat plan and the live pins show at once, and the scene is loaded as a chunk of its own.
 */
export function Twin() {
  // Asked once per visit: it creates, and at once releases, a throwaway context.
  const [canDraw] = useState(() => webgl2Available());
  return (
    <>
      <PageHeader
        title="Digital twin"
        description="The campus as it is simulated. Pick a building or a device to see what it reports."
      >
        <ViewSwitch current="twin" />
      </PageHeader>
      {canDraw ? (
        <TwinStage />
      ) : (
        <WithDock>
          <TwinFallback reason={{ kind: 'no-webgl2' }} />
        </WithDock>
      )}
    </>
  );
}

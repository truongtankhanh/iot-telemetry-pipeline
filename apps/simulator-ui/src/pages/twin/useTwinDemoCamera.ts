import { useEffect, useMemo, useRef } from 'react';
import type { TwinLayout } from '../../api/types';
import { DEMO_SCRIPTS } from '../../lib/demoScripts';
import { type CameraMove, cameraMove } from '../../lib/twinDemoCamera';
import { useDemoSession } from '../../state/demoSessionContext';

export interface TwinDemoCameraOptions {
  /** The campus layout, once there is one; without it no step can name a building. */
  layout: Pick<TwinLayout, 'zones' | 'catalogue'> | null;
  /** The address already puts a building in focus: the demo does not take the selection from the viewer at mount. */
  hasFocus: boolean;
  /**
   * What the page does with a move: select what it says to select, and, with `flight`, fly the camera. At mount the camera
   * is not flown (it starts there: `startMove`), only the selection is made.
   */
  apply: (move: CameraMove, flight: boolean) => void;
}

export interface TwinDemoCamera {
  /** A guided demo is being presented. */
  presenting: boolean;
  /** The move of the step on screen, for the scene's first view; `null` without a camera step or a layout. */
  startMove: CameraMove | null;
  /** Why the step's camera moves nothing (it names a building this layout lacks), or `null`. */
  problem: string | null;
}

/**
 * The twin's end of a guided-demo camera step (SIM-21). While a demo is presented, the camera of the step on screen is read from
 * the session and the script it names, and **the camera moves when a step comes on screen** — forward, back, restart, or on its
 * awaited event, which all set a new `stepStartedAt` — once for each, and never otherwise: a step without a camera leaves the
 * view where the presenter put it. The step that was on screen when the twin mounted does not fly: the scene starts there
 * (`startMove`), and the selection it needs is made, unless the address already chose a building. A move that arrives while the
 * scene's code is still loading has nothing to fly; the next step's does. The twin and the demo's driver are on the same page, so
 * this is a hook in the page and not a channel between two (the plan's DECISION NEEDED 3).
 */
export function useTwinDemoCamera({
  layout,
  hasFocus,
  apply,
}: TwinDemoCameraOptions): TwinDemoCamera {
  const session = useDemoSession();
  const presenting = session.status === 'presenting';
  const script = DEMO_SCRIPTS.find((entry) => entry.id === session.scriptId);
  const camera = presenting ? script?.steps[session.stepIndex]?.camera : undefined;

  const result = useMemo(
    () => (camera === undefined || layout === null ? null : cameraMove(camera, layout)),
    [camera, layout],
  );
  const move = result?.move ?? null;

  // A step comes on screen when its index or its start time changes.
  const key = `${session.stepIndex}:${session.stepStartedAt ?? ''}`;
  const mountedAt = useRef(key);
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (move === null || done.current === key) return;
    done.current = key;
    if (key === mountedAt.current) {
      if (!hasFocus) apply(move, false);
      return;
    }
    apply(move, true);
  }, [move, key, hasFocus, apply]);

  return { presenting, startMove: move, problem: result?.problem ?? null };
}

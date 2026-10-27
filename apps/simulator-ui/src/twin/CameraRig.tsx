import { useFrame, useThree } from '@react-three/fiber';
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TwinBoundary } from '../api/types';
import {
  type CameraNudge,
  type CameraTarget,
  type CameraView,
  clampTarget,
  MAX_DISTANCE_M,
  MIN_DISTANCE_M,
  nudgeView,
  polarLimitsRad,
  viewFor,
} from '../lib/twinCamera';
import { flightAt } from '../lib/twinFlight';

/** The share of the remaining movement that stays each frame while the view coasts to a stop. */
const DAMPING_FACTOR = 0.12;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What the page can ask of the camera: fly to a preset or a building, or take one step (the buttons and the keys). */
export interface CameraRigHandle {
  fly: (target: CameraTarget) => void;
  nudge: (nudge: CameraNudge) => void;
}

interface Flight {
  from: CameraView;
  to: CameraView;
  startedAt: number;
}

export interface CameraRigProps {
  boundary: TwinBoundary;
  /**
   * Where the camera is at the start, read once when the rig mounts (a later change is ignored: the view is the viewer's
   * from then on). Absent, it is the home view. A link that opens on a building starts at that building, with no flight.
   */
  start?: CameraTarget;
  ref?: Ref<CameraRigHandle>;
}

/**
 * The camera's controls: three's `OrbitControls` with the design's limits — a damped orbit, zoom to the cursor, pan on the
 * ground, a tilt of 20° to 78° from vertical, a distance of 60 to 900 m, and a target that cannot leave the site boundary
 * plus 40 m (clamped after every update, moving the camera with it so the view keeps its angle). The view starts at the home
 * view (or at `start`) and never moves by itself: it moves when the viewer drags, or when the page asks through the handle —
 * a flight to a preset or a building (600 ms, eased, instant under `prefers-reduced-motion`) or one step of a button or a
 * key. A flight ends the moment
 * the viewer takes hold of the view. The canvas draws on demand, so a change in the view asks for the next frame, and a
 * view that is still coasting or flying keeps asking until it stops. Damping is off under `prefers-reduced-motion`. The
 * controls are created when the rig mounts and disposed when it unmounts.
 */
export function CameraRig({ boundary, start, ref }: CameraRigProps) {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const read = useThree((state) => state.get);
  const controls = useRef<OrbitControls | null>(null);
  const flight = useRef<Flight | null>(null);
  // Kept from the first render: the effect below must not send the camera back when `start` changes later.
  const startRef = useRef(start);

  useEffect(() => {
    const { size } = read();
    const initial = viewFor(
      startRef.current ?? 'campus',
      boundary,
      size.width / Math.max(1, size.height),
    );
    camera.position.set(...initial.position);

    const orbit = new OrbitControls(camera, domElement);
    orbit.target.set(...initial.target);
    orbit.enableDamping = !prefersReducedMotion();
    orbit.dampingFactor = DAMPING_FACTOR;
    orbit.zoomToCursor = true;
    // Panning slides over the ground instead of lifting the view off it.
    orbit.screenSpacePanning = false;
    orbit.minDistance = MIN_DISTANCE_M;
    orbit.maxDistance = MAX_DISTANCE_M;
    const polar = polarLimitsRad();
    orbit.minPolarAngle = polar.min;
    orbit.maxPolarAngle = polar.max;
    // `invalidate` takes a number of frames, not the event the controls pass, so it is wrapped.
    const onChange = () => invalidate();
    // The viewer taking hold of the view (a drag, a wheel turn) ends a flight; the view is theirs from there.
    const onStart = () => {
      flight.current = null;
    };
    orbit.addEventListener('change', onChange);
    orbit.addEventListener('start', onStart);
    orbit.update();
    controls.current = orbit;
    invalidate();

    return () => {
      orbit.removeEventListener('change', onChange);
      orbit.removeEventListener('start', onStart);
      orbit.dispose();
      controls.current = null;
      flight.current = null;
    };
  }, [boundary, camera, domElement, invalidate, read]);

  useImperativeHandle(ref, () => {
    const viewNow = (orbit: OrbitControls): CameraView => ({
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [orbit.target.x, orbit.target.y, orbit.target.z],
    });
    const apply = (orbit: OrbitControls, view: CameraView) => {
      camera.position.set(...view.position);
      orbit.target.set(...view.target);
      orbit.update();
      invalidate();
    };
    return {
      fly(target) {
        const orbit = controls.current;
        if (orbit === null) return;
        const { width, height } = read().size;
        const to = viewFor(target, boundary, width / Math.max(1, height));
        // Read when asked, not when the rig was made: the setting can change while the page is open.
        if (prefersReducedMotion()) {
          flight.current = null;
          apply(orbit, to);
          return;
        }
        flight.current = { from: viewNow(orbit), to, startedAt: performance.now() };
        invalidate();
      },
      nudge(nudge) {
        const orbit = controls.current;
        if (orbit === null) return;
        flight.current = null;
        apply(orbit, nudgeView(viewNow(orbit), boundary, nudge));
      },
    };
  }, [boundary, camera, invalidate, read]);

  useFrame(() => {
    const orbit = controls.current;
    if (orbit === null) return;

    const active = flight.current;
    if (active !== null) {
      const frame = flightAt(active.from, active.to, performance.now() - active.startedAt);
      camera.position.set(...frame.position);
      orbit.target.set(...frame.target);
      if (frame.done) flight.current = null;
    }

    // While the view coasts, `update` moves it and fires `change`, which asks for the next frame.
    orbit.update();
    const { x, y, z } = orbit.target;
    const [cx, cy, cz] = clampTarget([x, y, z], boundary);
    if (cx !== x || cy !== y || cz !== z) {
      // The camera moves by the same amount as the target, so the view keeps its angle and distance.
      orbit.target.set(cx, cy, cz);
      camera.position.set(
        camera.position.x + (cx - x),
        camera.position.y + (cy - y),
        camera.position.z + (cz - z),
      );
      orbit.update();
    }
    // A flight in the air needs the next frame too: nothing else will ask for it.
    if (flight.current !== null) invalidate();
  });

  return null;
}

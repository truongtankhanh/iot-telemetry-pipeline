import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TwinBoundary } from '../api/types';
import {
  clampTarget,
  MAX_DISTANCE_M,
  MIN_DISTANCE_M,
  homeView,
  polarLimitsRad,
} from '../lib/twinCamera';

/** The share of the remaining movement that stays each frame while the view coasts to a stop. */
const DAMPING_FACTOR = 0.12;

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The camera's controls: three's `OrbitControls` with the design's limits — a damped orbit, zoom to the cursor, pan on the
 * ground, a tilt of 20° to 78° from vertical, a distance of 60 to 900 m, and a target that cannot leave the site boundary
 * plus 40 m (clamped after every update, moving the camera with it so the view keeps its angle). The view starts at the home
 * view and never moves by itself. The canvas draws on demand, so a change in the view asks for the next frame, and a view
 * that is still coasting keeps asking until it stops. Damping is off under `prefers-reduced-motion`. The controls are
 * created when the rig mounts and disposed when it unmounts.
 */
export function CameraRig({ boundary }: { boundary: TwinBoundary }) {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const read = useThree((state) => state.get);
  const controls = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const { size } = read();
    const home = homeView(boundary, size.width / Math.max(1, size.height));
    camera.position.set(...home.position);

    const orbit = new OrbitControls(camera, domElement);
    orbit.target.set(...home.target);
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
    orbit.addEventListener('change', onChange);
    orbit.update();
    controls.current = orbit;
    invalidate();

    return () => {
      orbit.removeEventListener('change', onChange);
      orbit.dispose();
      controls.current = null;
    };
  }, [boundary, camera, domElement, invalidate, read]);

  useFrame(() => {
    const orbit = controls.current;
    if (orbit === null) return;
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
  });

  return null;
}

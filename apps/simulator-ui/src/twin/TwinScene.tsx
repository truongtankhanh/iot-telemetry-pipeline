import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { TwinLayout } from '../api/types';
import { LENS } from '../lib/twinCamera';
import { watchContextLoss } from '../lib/webgl';
import { Buildings } from './Buildings';
import { CameraRig } from './CameraRig';
import { Ground } from './Ground';
import { twinColors } from './twinColors';

/**
 * The lights make the walls: every face is the top colour, and a Lambert surface lit by a hemisphere light (the same
 * all round, so the same on every face) and a key light from the west, a little south and well above gets
 *
 *   top = BASE + KEY·Ly,   south (normal +z) = BASE + KEY·Lz,   east (normal +x) = BASE + KEY·Lx
 *
 * which with these values is 1.00, 0.78 and 0.60 of the top: the command center's `--tw-south` and `--tw-east` over its
 * `--tw-top`. They are the command center's numbers (its `Lights.tsx`, calculated there and not yet read from a render),
 * and carry a factor of π because a punctual light of intensity π gives a Lambert surface its full colour in three.js
 * r155 and later. The key light comes from the west so that the south and east walls, which the home view sees, get
 * different shades.
 */
const BASE_LIGHT = 0.6;
const KEY_LIGHT = 0.53;
/** Towards the light in scene axes (`x` east, `y` up, `z` minus north): only the direction matters. */
const TOWARDS_LIGHT: [number, number, number] = [-0.57, 0.75, 0.34];

/** The canvas draws only on demand and at most at this pixel ratio (the design's performance rules). */
const MAX_PIXEL_RATIO = 1.5;

/**
 * Marks the first frame drawn with the scene in the browser's User Timing (`twin:first-frame`), so a Performance
 * recording shows when it appeared. A subscriber runs just before the frame is rendered, a few milliseconds before it is
 * on screen.
 */
function FirstFrameMark() {
  const marked = useRef(false);
  useFrame(() => {
    if (marked.current) return;
    marked.current = true;
    performance.mark('twin:first-frame');
  });
  return null;
}

export interface TwinSceneProps {
  layout: TwinLayout;
  /** Called once when the WebGL context was lost and has not come back in 5 seconds: the page then shows Topology. */
  onContextLost: () => void;
  className?: string;
}

/**
 * The 3D campus of the spike (SIM-17): the ground, the site boundary and the extruded buildings, lit and seen through
 * orbit controls, on a canvas that draws on demand. This module and its siblings in `src/twin/` are the only code that
 * imports three.js or React Three Fiber, and the page imports it only through a dynamic `import()`, so it is its own
 * chunk and a device without WebGL 2 never downloads it.
 *
 * The scene is a picture with a text alternative: the wrapper is an image, and the page next to it states the same
 * facts as text (and, from SIM-18, lists the devices). jsdom cannot draw it, so it is checked by hand.
 */
export function TwinScene({ layout, onContextLost, className }: TwinSceneProps) {
  const stop = useRef<(() => void) | null>(null);
  const latest = useRef(onContextLost);
  useEffect(() => {
    latest.current = onContextLost;
  });
  useEffect(() => () => stop.current?.(), []);

  const buildings = layout.zones.filter((zone) => zone.kind === 'building').length;
  return (
    <div
      className={className}
      role="img"
      aria-label={`The campus in 3D: the site boundary and ${buildings} buildings. Drag to orbit, scroll to zoom, right-drag to pan. The same facts are listed below as text.`}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, MAX_PIXEL_RATIO]}
        // No tone mapping: the colours are the tokens', not a grade of them.
        flat
        camera={{ fov: LENS.fov, near: LENS.near, far: LENS.far }}
        onCreated={({ gl }) => {
          stop.current?.();
          stop.current = watchContextLoss(gl.domElement, () => latest.current());
        }}
      >
        <color attach="background" args={[twinColors.background]} />
        <hemisphereLight color="#ffffff" groundColor="#ffffff" intensity={BASE_LIGHT * Math.PI} />
        <directionalLight
          color="#ffffff"
          position={TOWARDS_LIGHT}
          intensity={KEY_LIGHT * Math.PI}
        />
        <Ground boundary={layout.boundary} />
        <Buildings zones={layout.zones} />
        <CameraRig boundary={layout.boundary} />
        <FirstFrameMark />
      </Canvas>
    </div>
  );
}

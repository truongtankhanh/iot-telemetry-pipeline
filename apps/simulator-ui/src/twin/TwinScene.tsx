import { Canvas, useFrame } from '@react-three/fiber';
import { type Ref, useEffect, useRef } from 'react';
import type { TwinAsset, TwinLayout } from '../api/types';
import type { TopologyState } from '../lib/topologyState';
import { LENS } from '../lib/twinCamera';
import type { TwinPin } from '../lib/twinPins';
import type { SceneProblem } from '../lib/twinStatus';
import type { TwinSelection } from '../lib/twinQuery';
import { watchContextLoss } from '../lib/webgl';
import { Buildings } from './Buildings';
import { CameraRig, type CameraRigHandle } from './CameraRig';
import { CatalogueMarkers } from './CatalogueMarkers';
import { Ground } from './Ground';
import { LabelProjector, type ViewListener } from './LabelProjector';
import { Pins } from './Pins';
import { twinColors } from './twinColors';

export type { CameraRigHandle as TwinSceneHandle } from './CameraRig';
export type { ViewListener } from './LabelProjector';

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
  pins: readonly TwinPin[];
  /** The look of each building by its code: the worst of its devices, or `null` for none. */
  buildingStates: Readonly<Record<string, TopologyState | null>>;
  /** The nine catalogue assets drawn at campus level. */
  catalogue: readonly TwinAsset[];
  /** Which layers are on. */
  layers: { devices: boolean; catalogue: boolean };
  selection: TwinSelection | null;
  /** What the pointer is over, for the cursor and the larger hovered pin. */
  hovered: TwinSelection | null;
  /** The pointer is over a building or a pin (reported on every move; the caller ignores what it knows). */
  onHover: (target: TwinSelection) => void;
  /** The pointer left a building or a pin; the caller clears the hover only if it is still that target. */
  onLeave: (target: TwinSelection) => void;
  /** A click on a building or a pin (a drag of the camera is not one). */
  onSelect: (target: TwinSelection) => void;
  /** The camera moved or the canvas was resized: for the DOM overlays that follow the pins. */
  onView: ViewListener;
  /**
   * The scene cannot be shown: the WebGL context was lost and has not come back in 5 seconds (called once), or its code did
   * not load (said by the stand-in the page puts in its place). The page then shows Topology.
   */
  onUnavailable: (problem: SceneProblem) => void;
  className?: string;
  /** Fly to a preset, take one step: what the camera buttons and the keys ask for. */
  ref?: Ref<CameraRigHandle>;
}

/**
 * The 3D campus (SIM-18): the ground, the site boundary, the extruded buildings with the look of their worst device, a pin
 * for each placed device, the catalogue markers, orbit controls the page can also drive, and the projection the DOM labels
 * need, on a canvas that draws on demand. This module and its siblings in `src/twin/` are the only code that imports
 * three.js or React Three Fiber, and the page imports it only through a dynamic `import()`, so it is its own chunk and a
 * device without WebGL 2 never downloads it.
 *
 * The scene is a picture with a text alternative: the wrapper is an image, and the page states the same facts as text
 * (the headline, and a visually hidden list of every device). Labels, the tooltip and the controls are DOM and sit
 * beside this wrapper, not inside it. jsdom cannot draw it, so it is checked by hand.
 */
export function TwinScene({
  layout,
  pins,
  buildingStates,
  catalogue,
  layers,
  selection,
  hovered,
  onHover,
  onLeave,
  onSelect,
  onView,
  onUnavailable,
  className,
  ref,
}: TwinSceneProps) {
  const stop = useRef<(() => void) | null>(null);
  const latest = useRef(onUnavailable);
  useEffect(() => {
    latest.current = onUnavailable;
  });
  useEffect(() => () => stop.current?.(), []);

  const buildings = layout.zones.filter((zone) => zone.kind === 'building').length;
  return (
    <div
      className={className}
      role="img"
      // The pointer is over something to choose.
      style={hovered === null ? undefined : { cursor: 'pointer' }}
      aria-label={`The campus in 3D: the site boundary, ${buildings} buildings and ${pins.length} devices. Drag to orbit, scroll to zoom, right-drag to pan. The same facts are listed below as text.`}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, MAX_PIXEL_RATIO]}
        // No tone mapping: the colours are the tokens', not a grade of them.
        flat
        camera={{ fov: LENS.fov, near: LENS.near, far: LENS.far }}
        onCreated={({ gl }) => {
          stop.current?.();
          stop.current = watchContextLoss(gl.domElement, () => latest.current('context-lost'));
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
        <Buildings
          zones={layout.zones}
          states={buildingStates}
          selectedCode={selection?.type === 'zone' ? selection.id : null}
          onHover={onHover}
          onLeave={onLeave}
          onSelect={onSelect}
        />
        <CatalogueMarkers assets={catalogue} visible={layers.catalogue} />
        {/* The rig before the pins and the projector: frame callbacks run in the order they were registered, and the
            rig is what moves the camera that they read. */}
        <CameraRig boundary={layout.boundary} ref={ref} />
        <Pins
          pins={pins}
          selectedId={selection?.type === 'device' ? selection.id : null}
          hoveredId={hovered?.type === 'device' ? hovered.id : null}
          visible={layers.devices}
          onHover={onHover}
          onLeave={onLeave}
          onSelect={onSelect}
        />
        <LabelProjector onView={onView} />
        <FirstFrameMark />
      </Canvas>
    </div>
  );
}

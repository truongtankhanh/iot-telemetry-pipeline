import { Canvas, useFrame } from '@react-three/fiber';
import { type Ref, useEffect, useRef } from 'react';
import type { TwinLayout } from '../api/types';
import type { TopologyState } from '../lib/topologyState';
import { type CameraTarget, LENS } from '../lib/twinCamera';
import type { CatalogueBox } from '../lib/twinCatalogue';
import type { TwinFlow } from '../lib/twinFlow';
import type { HeatModel } from '../lib/twinHeat';
import type { TwinPin } from '../lib/twinPins';
import type { SceneProblem } from '../lib/twinStatus';
import type { TwinSelection } from '../lib/twinQuery';
import { watchContextLoss } from '../lib/webgl';
import { Arcs } from './Arcs';
import { Buildings } from './Buildings';
import { CameraRig, type CameraRigHandle } from './CameraRig';
import { CatalogueMarkers } from './CatalogueMarkers';
import { Dots, type PulseSource } from './Dots';
import { Ground } from './Ground';
import { HeatFloor } from './HeatFloor';
import { Hub } from './Hub';
import { LabelProjector, type ViewListener } from './LabelProjector';
import { Pins } from './Pins';
import { twinColors } from './twinColors';

export type { CameraRigHandle as TwinSceneHandle } from './CameraRig';
export type { ViewListener } from './LabelProjector';
export type { PulseSource } from './Dots';

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
  /**
   * The catalogue boxes to draw: the nine campus-level assets as cubes, or, with a building in focus, that building's
   * assets at their class footprint and the other buildings' campus-level ones dimmed.
   */
  catalogue: readonly CatalogueBox[];
  /** The building in focus: seen through, with the rest of the campus faded and its devices on its floor. `null` for the campus. */
  focusedCode: string | null;
  /** Where the camera starts (read once): a building when the address opens on one. Absent: the home view. */
  start?: CameraTarget;
  /** The Pipeline hub and the arc from each pin to it. */
  flow: TwinFlow;
  /** The arcs that hold a `line` slot of the animation budget (taken on the page): only these move dots. */
  granted: ReadonlySet<string>;
  /** The devices whose beacon may move (they hold a `node` slot of the animation budget); the other beacons are still. */
  moving: ReadonlySet<string>;
  /** Listens to the engine's published messages of the placed devices: what draws a dot. */
  pulses: PulseSource;
  /**
   * The floor of the building in focus: the squares of its heat (or a hatch), interpolated between the sensors. `null` at
   * campus level, where no floor is drawn.
   */
  heat: HeatModel | null;
  /** Which layers are on. */
  layers: {
    devices: boolean;
    catalogue: boolean;
    dataFlow: boolean;
    alerts: boolean;
    heat: boolean;
  };
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
 * The 3D campus (SIM-18, SIM-19, SIM-20): the ground, the site boundary, the extruded buildings with the look of their worst device,
 * a pin for each placed device (with a beacon while an alert is open on it), the logical Pipeline hub with an arc from each
 * pin and the dots that travel them, the catalogue markers, orbit controls the page can also drive, and the projection the DOM labels
 * need, on a canvas that draws on demand. This module and its siblings in `src/twin/` are the only code that imports
 * three.js or React Three Fiber, and the page imports it only through a dynamic `import()`, so it is its own chunk and a
 * device without WebGL 2 never downloads it.
 *
 * With a building in focus (SIM-20, `focusedCode`) the same scene is drawn one level in: that building is seen through,
 * its devices stand on its floor and its catalogue assets are boxes at their class footprint, and the rest of the campus
 * is faded; its floor is the heat (`HeatFloor`). What is faded, where a device stands and the colour of each square of the
 * floor are decided in `lib/` and arrive as plain data.
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
  focusedCode,
  start,
  heat,
  flow,
  granted,
  moving,
  pulses,
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
  const alerting = pins.filter((pin) => pin.alert !== null).length;
  const focusedName =
    focusedCode === null
      ? null
      : (layout.zones.find((zone) => zone.code === focusedCode)?.name ?? focusedCode);
  return (
    <div
      className={className}
      role="img"
      // The pointer is over something to choose.
      style={hovered === null ? undefined : { cursor: 'pointer' }}
      aria-label={
        focusedName === null
          ? `The campus in 3D: the site boundary, ${buildings} buildings and ${pins.length} devices${alerting === 0 ? '' : `, ${alerting} with an open alert`}, each joined by an arc to the logical Pipeline hub. Drag to orbit, scroll to zoom, right-drag to pan. The same facts are listed below as text.`
          : `${focusedName} in 3D with see-through walls: its devices stand on the floor and its catalogue assets are drawn as dashed boxes; the rest of the campus is faded. Drag to orbit, scroll to zoom, right-drag to pan. The same facts are listed below as text.`
      }
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
          focusedCode={focusedCode}
          onHover={onHover}
          onLeave={onLeave}
          onSelect={onSelect}
        />
        <HeatFloor heat={heat} visible={layers.heat} />
        <CatalogueMarkers boxes={catalogue} visible={layers.catalogue} />
        {/* The rig before the pins and the projector: frame callbacks run in the order they were registered, and the
            rig is what moves the camera that they read. */}
        <CameraRig boundary={layout.boundary} start={start} ref={ref} />
        <Arcs arcs={flow.arcs} visible={layers.dataFlow} />
        <Hub hub={flow.hub} visible={layers.dataFlow} />
        <Dots arcs={flow.arcs} granted={granted} pulses={pulses} visible={layers.dataFlow} />
        <Pins
          pins={pins}
          selectedId={selection?.type === 'device' ? selection.id : null}
          hoveredId={hovered?.type === 'device' ? hovered.id : null}
          visible={layers.devices}
          alerts={layers.alerts}
          moving={moving}
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

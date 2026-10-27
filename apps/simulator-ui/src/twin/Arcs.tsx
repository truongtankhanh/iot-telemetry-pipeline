import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import { LENS } from '../lib/twinCamera';
import { isLit, type TwinArc } from '../lib/twinFlow';
import { type DashPattern, ribbonIndices, writeRibbon } from '../lib/twinRibbon';
import { arcColors, ghostOpacity } from './twinColors';

/** Widths on the screen, in pixels: frame 14's halo (8) and core (2), a little wider for the glow to read at 1.5 pixel ratio. */
const HALO_PX = 9;
const CORE_PX = 2.2;
const DIM_CORE_PX = 1.6;
const HALO_OPACITY = 0.3;
/** A dim or red arc is dashed; a dropped-message gap on a lit one is a longer stretch drawn, a shorter left out. */
const WIRE_DASH: DashPattern = { on: 1, off: 1 };
const GAP_DASH: DashPattern = { on: 2, off: 1 };

interface Ribbon {
  geometry: BufferGeometry;
  positions: Float32Array;
  attribute: BufferAttribute;
  widthPx: number;
}

function ribbonOf(arc: TwinArc, widthPx: number, dash: DashPattern | null): Ribbon {
  const positions = new Float32Array(arc.points.length * 6);
  // `BufferAttribute` keeps the array it is given (`Float32BufferAttribute` copies it), and the frame writes into this one.
  const attribute = new BufferAttribute(positions, 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', attribute);
  geometry.setIndex(ribbonIndices(arc.points.length - 1, dash));
  return { geometry, positions, attribute, widthPx };
}

interface Built {
  arc: TwinArc;
  halo: Ribbon | null;
  core: Ribbon;
}

/** What an arc is made of: a lit one has a soft halo under its core; a dim or red one is a dashed wire, with no glow. */
function build(arc: TwinArc): Built {
  const lit = isLit(arc.look);
  const dash = !lit ? WIRE_DASH : arc.gaps ? GAP_DASH : null;
  return {
    arc,
    halo: lit ? ribbonOf(arc, HALO_PX, null) : null,
    core: ribbonOf(arc, lit ? CORE_PX : DIM_CORE_PX, dash),
  };
}

export interface ArcsProps {
  arcs: readonly TwinArc[];
  visible: boolean;
}

/**
 * The neon arcs from each pin to the Pipeline hub (SIM-19, D1): for a lit arc a wide, additive, low-opacity halo and a
 * narrow core, in cyan or amber; for an arc that does not carry (a silent device, a hub that is down, a cut link) a dashed
 * wire in grey or red. Each is a **ribbon** that faces the camera and keeps its width in pixels (`writeRibbon`), because a
 * line is one pixel wide in WebGL. No bloom pass and no filter: a bloom costs more than six arcs justify and would glow the
 * buildings too. The ribbons are rewritten whenever the scene is drawn, which is when the camera moved or something
 * changed; nothing here asks for a frame of its own. A drop is drawn as gaps in the core. An arc that leaves a faded pin
 * (another building is in focus) is drawn at the ghost opacity. The dots that travel the arcs are `Dots`. The geometries
 * are **disposed** when the arcs change or the scene unmounts.
 */
export function Arcs({ arcs, visible }: ArcsProps) {
  const invalidate = useThree((state) => state.invalidate);
  const built = useMemo(() => arcs.map(build), [arcs]);

  useEffect(
    () => () => {
      for (const { halo, core } of built) {
        halo?.geometry.dispose();
        core.geometry.dispose();
      }
    },
    [built],
  );
  useEffect(() => invalidate(), [built, visible, invalidate]);

  const tanHalfFov = Math.tan((LENS.fov * Math.PI) / 360);
  useFrame(({ camera, size }) => {
    if (!visible) return;
    const metresPerPixel = (2 * tanHalfFov) / Math.max(1, size.height);
    const eye: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
    for (const { arc, halo, core } of built) {
      for (const ribbon of halo === null ? [core] : [halo, core]) {
        writeRibbon(ribbon.positions, arc.points, eye, metresPerPixel, ribbon.widthPx);
        ribbon.attribute.needsUpdate = true;
      }
    }
  });

  if (!visible) return null;
  return (
    <>
      {built.map(({ arc, halo, core }) => (
        <group key={arc.id}>
          {halo === null ? null : (
            // Additive and without a depth test: the glow adds light over what is behind it, and the arc is seen over the
            // roofs it crosses. Culling is off because the vertices are rewritten each frame and the bounds are not.
            <mesh geometry={halo.geometry} renderOrder={5} frustumCulled={false}>
              <meshBasicMaterial
                color={arcColors[arc.look]}
                transparent
                opacity={arc.dim ? HALO_OPACITY * ghostOpacity : HALO_OPACITY}
                blending={AdditiveBlending}
                depthTest={false}
                depthWrite={false}
                side={DoubleSide}
              />
            </mesh>
          )}
          <mesh geometry={core.geometry} renderOrder={6} frustumCulled={false}>
            <meshBasicMaterial
              color={arcColors[arc.look]}
              transparent={arc.dim || !isLit(arc.look)}
              opacity={arc.dim ? ghostOpacity : isLit(arc.look) ? 1 : 0.8}
              depthTest={false}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}

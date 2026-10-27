import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute } from 'three';
import {
  FLOOR_Y_M,
  type HeatModel,
  hatchLines,
  heatQuads,
  QUAD_INDICES,
  quadPositions,
} from '../lib/twinHeat';
import { focusColors, heatHatch } from './twinColors';

export interface HeatFloorProps {
  /** The floor of the building in focus; `null` at campus level, where there is no floor to draw. */
  heat: HeatModel | null;
  /** The Heat layer is on: the floor is tinted (or hatched). Off, it is the plain floor the walls stand on. */
  visible: boolean;
}

/** The floor of one footprint as a single quad. */
function plainFloor(heat: HeatModel): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(quadPositions(heat.box, FLOOR_Y_M), 3),
  );
  geometry.setIndex([...QUAD_INDICES]);
  return geometry;
}

/** The squares of the floor, each painted in the colour the model gave it; `null` when the floor has none (it is hatched). */
function tintedFloor(heat: HeatModel): BufferGeometry | null {
  if (heat.colors.length === 0) return null;
  const { positions, indices, cells } = heatQuads(heat.box);
  const colors = new Float32Array(cells * 4 * 3);
  for (let cell = 0; cell < cells; cell += 1) {
    // `Color` converts the sRGB hex into the working colour space; writing the bytes would read as linear and come out light.
    const rgb = new Color(heat.colors[cell] ?? 0).toArray();
    for (let corner = 0; corner < 4; corner += 1) colors.set(rgb, (cell * 4 + corner) * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * The floor of the building in focus (frame 15): an opaque base the see-through walls stand on and, with the Heat layer on,
 * either the squares tinted on the command center's ramp (**interpolated between the sensors, not measured**: the legend and
 * the text say so) or, when no sensor of the building reports a temperature, a **hatch** — a shape, not a colour, so a floor
 * with nothing to show is never read as a cold one. The squares are vertex colours on one mesh, the hatch one merged
 * `LineSegments`: no texture, no image, three draw calls at most. The model arrives rounded and through `Stable`, so this
 * redraws only when a square changed colour; it asks for one frame then, and has no loop of its own. All three geometries
 * are **disposed** when the model changes or the scene unmounts.
 */
export function HeatFloor({ heat, visible }: HeatFloorProps) {
  const invalidate = useThree((state) => state.invalidate);

  const base = useMemo(() => (heat === null ? null : plainFloor(heat)), [heat]);
  const tint = useMemo(() => (heat === null ? null : tintedFloor(heat)), [heat]);
  const hatch = useMemo(() => {
    if (heat === null || heat.colors.length > 0) return null;
    const lines = new BufferGeometry();
    lines.setAttribute('position', new Float32BufferAttribute(hatchLines(heat.box), 3));
    return lines;
  }, [heat]);

  useEffect(() => () => base?.dispose(), [base]);
  useEffect(() => () => tint?.dispose(), [tint]);
  useEffect(() => () => hatch?.dispose(), [hatch]);
  useEffect(() => invalidate(), [base, tint, hatch, visible, invalidate]);

  if (base === null) return null;
  return (
    <>
      <mesh geometry={base}>
        <meshBasicMaterial color={focusColors.floor} side={DoubleSide} />
      </mesh>
      {visible && tint !== null ? (
        <mesh geometry={tint}>
          <meshBasicMaterial vertexColors side={DoubleSide} />
        </mesh>
      ) : null}
      {visible && hatch !== null ? (
        <lineSegments geometry={hatch}>
          <lineBasicMaterial color={heatHatch.color} transparent opacity={heatHatch.opacity} />
        </lineSegments>
      ) : null}
    </>
  );
}

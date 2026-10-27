import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { CatalogueBox } from '../lib/twinCatalogue';
import { sceneOf } from '../lib/twinGeometry';
import { ghostOpacity, markerColor } from './twinColors';

const DASH_M = 1.2;
const GAP_M = 1;
const MARKER_OPACITY = 0.55;

/** The twelve edges of a box centred on its position, as pairs of points, and a stem to the ground for an elevated one. */
function segmentsOf(box: CatalogueBox): number[][] {
  const [width, depth, height] = box.size;
  // East is `x`, up is `y`, north is minus `z`: the box's width runs along `x`, its depth along `z`.
  const [x, y, z] = sceneOf(box.at[0], box.at[1], box.elevationM + height / 2);
  const corner = (index: number): number[] => [
    x + (index & 4 ? width / 2 : -width / 2),
    y + (index & 2 ? height / 2 : -height / 2),
    z + (index & 1 ? depth / 2 : -depth / 2),
  ];
  const segments: number[][] = [];
  for (let a = 0; a < 8; a += 1) {
    // Two corners are joined by an edge when their indices differ in exactly one bit.
    for (const bit of [1, 2, 4]) {
      if ((a & bit) === 0) segments.push([...corner(a), ...corner(a | bit)]);
    }
  }
  if (box.elevationM > 0) segments.push([x, 0, z, x, box.elevationM, z]);
  return segments;
}

/** One merged set of dashed edges for these boxes, or `null` for none. */
function geometryOf(boxes: readonly CatalogueBox[]): BufferGeometry | null {
  const segments = boxes.flatMap(segmentsOf);
  if (segments.length === 0) return null;
  const positions = segments.flat();
  const distances = segments.flatMap(([ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0]) => [
    0,
    Math.hypot(bx - ax, by - ay, bz - az),
  ]);
  const lines = new BufferGeometry();
  lines.setAttribute('position', new Float32BufferAttribute(positions, 3));
  lines.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1));
  return lines;
}

export interface CatalogueMarkersProps {
  boxes: readonly CatalogueBox[];
  visible: boolean;
}

/**
 * The catalogue layer: the command center's assets as dim dashed boxes at their positions (frame 14, frame 15), so the
 * campus looks as complete as the command center's and the gap to V2 is visible instead of hidden. At campus level the
 * boxes are the nine campus-level assets as cubes; with a building in focus they are that building's assets at the
 * footprint of their class, and the other buildings' campus-level assets are drawn dimmer (`faded`). They are not
 * simulated, and the legend and the text list say so; they cannot be picked. Two merged `LineSegments` (bright and dim)
 * with a dashed material: dashes need each segment's length from its start, which `computeLineDistances` would give and
 * is written here as the `lineDistance` attribute because the geometry is built from numbers. **Disposed** with their
 * geometry when the boxes change or the scene unmounts.
 */
export function CatalogueMarkers({ boxes, visible }: CatalogueMarkersProps) {
  const invalidate = useThree((state) => state.invalidate);

  const bright = useMemo(() => geometryOf(boxes.filter((box) => !box.faded)), [boxes]);
  const dim = useMemo(() => geometryOf(boxes.filter((box) => box.faded)), [boxes]);

  useEffect(() => () => bright?.dispose(), [bright]);
  useEffect(() => () => dim?.dispose(), [dim]);
  useEffect(() => invalidate(), [bright, dim, visible, invalidate]);

  if (!visible) return null;
  return (
    <>
      {bright === null ? null : (
        <lineSegments geometry={bright}>
          <lineDashedMaterial
            color={markerColor}
            dashSize={DASH_M}
            gapSize={GAP_M}
            transparent
            opacity={MARKER_OPACITY}
          />
        </lineSegments>
      )}
      {dim === null ? null : (
        <lineSegments geometry={dim}>
          <lineDashedMaterial
            color={markerColor}
            dashSize={DASH_M}
            gapSize={GAP_M}
            transparent
            opacity={MARKER_OPACITY * ghostOpacity}
          />
        </lineSegments>
      )}
    </>
  );
}

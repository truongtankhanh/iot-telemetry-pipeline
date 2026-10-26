import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { TwinAsset } from '../api/types';
import { sceneOf } from '../lib/twinGeometry';
import { markerColor } from './twinColors';

/** A marker is a box this many metres on a side: the nine assets are drawn the same size, as marks, not as models. */
const MARKER_SIZE_M = 5;
const DASH_M = 1.2;
const GAP_M = 1;
const MARKER_OPACITY = 0.55;

/** The twelve edges of a box centred on `(x, y, z)`, as pairs of points, and a stem to the ground for an elevated one. */
function segmentsOf(asset: TwinAsset): number[][] {
  const half = MARKER_SIZE_M / 2;
  const [x, y, z] = sceneOf(asset.at[0], asset.at[1], asset.elevationM + half);
  const corner = (index: number): number[] => [
    x + (index & 4 ? half : -half),
    y + (index & 2 ? half : -half),
    z + (index & 1 ? half : -half),
  ];
  const segments: number[][] = [];
  for (let a = 0; a < 8; a += 1) {
    // Two corners are joined by an edge when their indices differ in exactly one bit.
    for (const bit of [1, 2, 4]) {
      if ((a & bit) === 0) segments.push([...corner(a), ...corner(a | bit)]);
    }
  }
  if (asset.elevationM > 0) segments.push([x, 0, z, x, asset.elevationM, z]);
  return segments;
}

/**
 * The catalogue layer: the command center's assets that it draws at campus level, as dim dashed boxes at their positions
 * (frame 14), so the campus looks as complete as the command center's and the gap to V2 is visible instead of hidden.
 * They are not simulated, and the legend and the text list say so; they cannot be picked. One merged `LineSegments` with a
 * dashed material: dashes need each segment's length from its start, which `computeLineDistances` would give and is
 * written here as the `lineDistance` attribute because the geometry is built from numbers. **Disposed** with its
 * geometry when the assets change or the scene unmounts.
 */
export function CatalogueMarkers({
  assets,
  visible,
}: {
  assets: readonly TwinAsset[];
  visible: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);

  const geometry = useMemo(() => {
    const segments = assets.flatMap(segmentsOf);
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
  }, [assets]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => invalidate(), [geometry, visible, invalidate]);

  if (!visible || geometry === null) return null;
  return (
    <lineSegments geometry={geometry}>
      <lineDashedMaterial
        color={markerColor}
        dashSize={DASH_M}
        gapSize={GAP_M}
        transparent
        opacity={MARKER_OPACITY}
      />
    </lineSegments>
  );
}

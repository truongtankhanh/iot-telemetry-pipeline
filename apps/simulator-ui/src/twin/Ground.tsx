import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute, Shape, ShapeGeometry } from 'three';
import type { TwinBoundary } from '../api/types';
import { boundaryRing } from '../lib/twinGeometry';
import { twinColors } from './twinColors';

/** The fill lies a hair under the buildings' feet and the outline a hair above it, so neither fights the other. */
const GROUND_Y = -0.1;
const OUTLINE_Y = 0.05;

/**
 * The site: the ground filled inside the boundary, as the command center fills its `boundaryFill`, and the boundary
 * drawn on it. Outside the boundary there is only the background, so no edge of a plane is ever in the picture. Both
 * geometries are built once per boundary and **disposed** when it changes or the scene unmounts: React Three Fiber does
 * not dispose a geometry it was handed as a prop. A change asks for one frame, since the canvas draws only on demand.
 */
export function Ground({ boundary }: { boundary: TwinBoundary }) {
  const invalidate = useThree((state) => state.invalidate);
  const ring = useMemo(() => boundaryRing(boundary), [boundary]);

  const fill = useMemo(() => {
    // The ring is [x, z] in scene metres. A shape lies in x and y and faces +z; turned flat about x it faces up and
    // its y becomes −z, so the shape is drawn at (x, −z).
    const shape = new Shape();
    ring.forEach(([x, z], index) => {
      if (index === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    const geometry = new ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, GROUND_Y, 0);
    return geometry;
  }, [ring]);

  const outline = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        ring.flatMap(([x, z]) => [x, OUTLINE_Y, z]),
        3,
      ),
    );
    return geometry;
  }, [ring]);

  useEffect(() => () => fill.dispose(), [fill]);
  useEffect(() => () => outline.dispose(), [outline]);
  useEffect(() => invalidate(), [fill, outline, invalidate]);

  return (
    <>
      <mesh geometry={fill}>
        <meshBasicMaterial color={twinColors.ground} />
      </mesh>
      <lineLoop geometry={outline}>
        <lineBasicMaterial color={twinColors.edge} />
      </lineLoop>
    </>
  );
}

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { TwinZone } from '../api/types';
import { buildingShells, buildShellGeometry } from '../lib/twinGeometry';
import { twinColors } from './twinColors';

/**
 * The buildings: every `building` zone extruded from its footprint (the zone inset by 8 m) to its height, as **one merged
 * mesh and one merged `LineSegments`** — two draw calls for the whole campus, however many buildings. The faces are one
 * material with a colour per vertex (every building at the top colour), which is what SIM-18 will paint a state into; the
 * lights make the walls darker than the top. The faces are pushed back a little (`polygonOffset`) so the outline wins on
 * the borders instead of fighting them. The geometry is built once per list of zones and **disposed** when it is replaced
 * or the scene unmounts; a change asks for one frame, since the canvas draws only on demand. A campus with no building
 * draws nothing.
 */
export function Buildings({ zones }: { zones: readonly TwinZone[] }) {
  const invalidate = useThree((state) => state.invalidate);

  const shell = useMemo(() => {
    const { positions, normals, indices, edges } = buildShellGeometry(buildingShells({ zones }));
    if (indices.length === 0) return null;

    const faces = new BufferGeometry();
    faces.setAttribute('position', new BufferAttribute(positions, 3));
    faces.setAttribute('normal', new BufferAttribute(normals, 3));
    // `Color` converts the sRGB hex into the working colour space; writing the bytes would read as linear and come out light.
    const top = new Color(twinColors.top).toArray();
    const colors = new Float32Array(positions.length);
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) colors.set(top, vertex * 3);
    faces.setAttribute('color', new BufferAttribute(colors, 3));
    faces.setIndex(new BufferAttribute(indices, 1));

    const outline = new BufferGeometry();
    outline.setAttribute('position', new BufferAttribute(edges, 3));
    return { faces, outline };
  }, [zones]);

  useEffect(() => {
    if (shell === null) return;
    return () => {
      shell.faces.dispose();
      shell.outline.dispose();
    };
  }, [shell]);
  useEffect(() => invalidate(), [shell, invalidate]);

  if (shell === null) return null;
  return (
    <>
      <mesh geometry={shell.faces}>
        <meshLambertMaterial
          vertexColors
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <lineSegments geometry={shell.outline}>
        <lineBasicMaterial color={twinColors.edge} />
      </lineSegments>
    </>
  );
}

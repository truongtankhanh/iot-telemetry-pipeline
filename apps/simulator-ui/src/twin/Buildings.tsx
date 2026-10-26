import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { TwinZone } from '../api/types';
import type { TopologyState } from '../lib/topologyState';
import { buildingAtFace, buildingShells, buildShellGeometry } from '../lib/twinGeometry';
import type { TwinSelection } from '../lib/twinQuery';
import { buildingTop, rimColor, stateColors, twinColors } from './twinColors';

/** A click that moved the pointer further than this (in pixels) was a drag of the camera, not a choice. */
export const CLICK_SLOP_PX = 4;

export interface BuildingsProps {
  zones: readonly TwinZone[];
  /** The look of each building by its code: the worst of its devices, or `null` for none. */
  states: Readonly<Record<string, TopologyState | null>>;
  /** The building drawn with the selected outline. */
  selectedCode: string | null;
  /** The pointer is over a building (reported on every move; the caller ignores what it already knows). */
  onHover: (target: TwinSelection) => void;
  /** The pointer left every building. */
  onLeave: (target: TwinSelection) => void;
  onSelect: (target: TwinSelection) => void;
}

/** Writes one colour, as the working colour space has it, into every vertex of `[first, first + count)`. */
function paint(attribute: BufferAttribute, first: number, count: number, hex: number): void {
  // `Color` converts the sRGB hex into the working colour space; writing the bytes would read as linear and come out light.
  const rgb = new Color(hex).toArray();
  for (let vertex = first; vertex < first + count; vertex += 1) {
    attribute.array.set(rgb, vertex * 3);
  }
  attribute.needsUpdate = true;
}

/**
 * The buildings: every `building` zone extruded from its footprint (the zone inset by 8 m) to its height, as **one merged
 * mesh and one merged `LineSegments`** — two draw calls for the whole campus, however many buildings. A colour per vertex
 * paints each building's state into the same two geometries: its top (and so its walls, which the lights shade) takes a
 * tint when its worst device is in an anomaly or dark, and its outline takes the colour of that state, or the selected
 * colour. A line is one pixel wide in WebGL, so the state is carried by the tint as much as by the outline. The faces are
 * pushed back a little (`polygonOffset`) so the outline wins on the borders instead of fighting them.
 *
 * A pointer hit on the mesh is mapped to its building through the ranges `buildShellGeometry` returns. The mesh is one
 * object, so moving from one building to another fires no "out" and "over": the building is read on every move and
 * reported. The geometry is built once per list of zones and **disposed** when it is replaced or the
 * scene unmounts; a repaint asks for one frame, since the canvas draws only on demand. A campus with no building draws
 * nothing.
 */
export function Buildings({
  zones,
  states,
  selectedCode,
  onHover,
  onLeave,
  onSelect,
}: BuildingsProps) {
  const invalidate = useThree((state) => state.invalidate);
  // The last building the pointer was over, so that leaving the mesh can say which one it left.
  const hovered = useRef<string | null>(null);

  const shell = useMemo(() => {
    const shells = buildingShells({ zones });
    const { positions, normals, indices, edges, ranges } = buildShellGeometry(shells);
    if (indices.length === 0) return null;

    const faces = new BufferGeometry();
    faces.setAttribute('position', new BufferAttribute(positions, 3));
    faces.setAttribute('normal', new BufferAttribute(normals, 3));
    const faceColors = new BufferAttribute(new Float32Array(positions.length), 3);
    faces.setAttribute('color', faceColors);
    // Neutral until the effect below paints the states, so the first frame is never black.
    paint(faceColors, 0, positions.length / 3, twinColors.top);
    faces.setIndex(new BufferAttribute(indices, 1));

    const outline = new BufferGeometry();
    outline.setAttribute('position', new BufferAttribute(edges, 3));
    const edgeColors = new BufferAttribute(new Float32Array(edges.length), 3);
    outline.setAttribute('color', edgeColors);
    paint(edgeColors, 0, edges.length / 3, twinColors.edge);

    // Every building has the same number of vertices and of outline vertices.
    return {
      faces,
      outline,
      faceColors,
      edgeColors,
      ranges,
      codes: shells.map((entry) => entry.code),
      facesPerBuilding: positions.length / 3 / shells.length,
      edgesPerBuilding: edges.length / 3 / shells.length,
    };
  }, [zones]);

  useEffect(() => {
    if (shell === null) return;
    return () => {
      shell.faces.dispose();
      shell.outline.dispose();
    };
  }, [shell]);

  // The paint is a write to GPU buffers: an effect, and a frame asked for when it is done.
  useEffect(() => {
    if (shell === null) return;
    shell.codes.forEach((code, index) => {
      const state = states[code] ?? null;
      paint(
        shell.faceColors,
        index * shell.facesPerBuilding,
        shell.facesPerBuilding,
        buildingTop(state),
      );
      paint(
        shell.edgeColors,
        index * shell.edgesPerBuilding,
        shell.edgesPerBuilding,
        code === selectedCode ? stateColors.selected : rimColor(state),
      );
    });
    invalidate();
  }, [shell, states, selectedCode, invalidate]);

  if (shell === null) return null;

  const buildingOf = (event: { faceIndex?: number | null | undefined }): string | null =>
    typeof event.faceIndex === 'number' ? buildingAtFace(shell.ranges, event.faceIndex) : null;

  return (
    <>
      <mesh
        geometry={shell.faces}
        onPointerMove={(event) => {
          const code = buildingOf(event);
          if (code === null) return;
          hovered.current = code;
          onHover({ type: 'zone', id: code });
        }}
        onPointerOut={() => {
          const code = hovered.current;
          hovered.current = null;
          if (code !== null) onLeave({ type: 'zone', id: code });
        }}
        onClick={(event) => {
          // A drag of the camera ends in a click on whatever is under the pointer; it chooses nothing.
          if (event.delta > CLICK_SLOP_PX) return;
          const code = buildingOf(event);
          if (code !== null) onSelect({ type: 'zone', id: code });
        }}
      >
        <meshLambertMaterial
          vertexColors
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <lineSegments geometry={shell.outline}>
        <lineBasicMaterial vertexColors />
      </lineSegments>
    </>
  );
}

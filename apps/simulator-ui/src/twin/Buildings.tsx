import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute } from 'three';
import type { TwinZone } from '../api/types';
import type { TopologyState } from '../lib/topologyState';
import {
  buildingAtFace,
  buildingShells,
  buildShellGeometry,
  ROOF_INDICES,
} from '../lib/twinGeometry';
import type { TwinSelection } from '../lib/twinQuery';
import {
  buildingTop,
  focusColors,
  ghostOpacity,
  rimColor,
  stateColors,
  twinColors,
} from './twinColors';

/** A click that moved the pointer further than this (in pixels) was a drag of the camera, not a choice. */
export const CLICK_SLOP_PX = 4;

/** The roof outline of the building in focus is dashed: the roof is not drawn, and the outline says where it was. */
const ROOF_DASH_M = 3;
const ROOF_GAP_M = 2;

/** The focused building takes no pointer: the pins and markers inside it must be reachable through its walls. */
const noRaycast = () => undefined;

export interface BuildingsProps {
  zones: readonly TwinZone[];
  /** The look of each building by its code: the worst of its devices, or `null` for none. */
  states: Readonly<Record<string, TopologyState | null>>;
  /** The building drawn with the selected outline. */
  selectedCode: string | null;
  /** The building in focus: drawn see-through and apart from the rest, which is faded. `null` for the campus. */
  focusedCode: string | null;
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

/** Pairs of points as lines; `dashed` adds the length of each segment from its start, which a dashed material needs. */
function linesOf(values: readonly number[], dashed: boolean): BufferGeometry {
  const lines = new BufferGeometry();
  lines.setAttribute('position', new Float32BufferAttribute(values, 3));
  if (dashed) {
    const distances: number[] = [];
    for (let at = 0; at < values.length; at += 6) {
      distances.push(
        0,
        Math.hypot(
          (values[at + 3] ?? 0) - (values[at] ?? 0),
          (values[at + 4] ?? 0) - (values[at + 1] ?? 0),
          (values[at + 5] ?? 0) - (values[at + 2] ?? 0),
        ),
      );
    }
    lines.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1));
  }
  return lines;
}

/**
 * The buildings: every `building` zone extruded from its footprint (the zone inset by 8 m) to its height, as **one merged
 * mesh and one merged `LineSegments`** — two draw calls for the whole campus, however many buildings. A colour per vertex
 * paints each building's state into the same two geometries: its top (and so its walls, which the lights shade) takes a
 * tint when its worst device is in an anomaly or dark, and its outline takes the colour of that state, or the selected
 * colour. A line is one pixel wide in WebGL, so the state is carried by the tint as much as by the outline. The faces are
 * pushed back a little (`polygonOffset`) so the outline wins on the borders instead of fighting them.
 *
 * **With a building in focus (SIM-20)** it is taken out of the merged mesh and drawn on its own, see-through: no roof (its
 * outline is dashed where the roof was), walls at one low opacity, and **no pointer**, so the pins and markers inside are
 * reachable. The merged mesh is then drawn without it, at the ghost opacity: the rest of the campus fades, and a click
 * on a faded building still chooses it. Both geometries are rebuilt only when the zones or the focus change.
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
  focusedCode,
  onHover,
  onLeave,
  onSelect,
}: BuildingsProps) {
  const invalidate = useThree((state) => state.invalidate);
  // The last building the pointer was over, so that leaving the mesh can say which one it left.
  const hovered = useRef<string | null>(null);

  const shell = useMemo(() => {
    const shells = buildingShells({ zones }).filter((entry) => entry.code !== focusedCode);
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
  }, [zones, focusedCode]);

  const focused = useMemo(() => {
    if (focusedCode === null) return null;
    const shells = buildingShells({ zones }).filter((entry) => entry.code === focusedCode);
    const [only] = shells;
    if (only === undefined) return null;
    const { positions, normals, indices, edges } = buildShellGeometry(shells);

    const walls = new BufferGeometry();
    walls.setAttribute('position', new BufferAttribute(positions, 3));
    walls.setAttribute('normal', new BufferAttribute(normals, 3));
    walls.setIndex(new BufferAttribute(indices, 1));
    // The roof quad comes first in the index run: skipping it leaves the four walls.
    walls.setDrawRange(ROOF_INDICES, indices.length - ROOF_INDICES);

    // An edge is a roof edge when both its ends are at the roof's height (stored as a 32-bit float).
    const top = Math.fround(only.heightM);
    const solid: number[] = [];
    const roof: number[] = [];
    for (let at = 0; at < edges.length; at += 6) {
      const onRoof = edges[at + 1] === top && edges[at + 4] === top;
      (onRoof ? roof : solid).push(...edges.slice(at, at + 6));
    }
    return { walls, solid: linesOf(solid, false), roof: linesOf(roof, true) };
  }, [zones, focusedCode]);

  useEffect(() => {
    if (shell === null) return;
    return () => {
      shell.faces.dispose();
      shell.outline.dispose();
    };
  }, [shell]);

  useEffect(() => {
    if (focused === null) return;
    return () => {
      focused.walls.dispose();
      focused.solid.dispose();
      focused.roof.dispose();
    };
  }, [focused]);

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

  // The building in focus is a plain material, not a painted vertex: its tint and its rim are read from the same states.
  const focusedState = focusedCode === null ? null : (states[focusedCode] ?? null);
  const focusedRim = focusedCode === selectedCode ? stateColors.selected : rimColor(focusedState);
  useEffect(() => invalidate(), [focused, focusedState, focusedRim, invalidate]);

  const buildingOf = (event: { faceIndex?: number | null | undefined }): string | null =>
    shell !== null && typeof event.faceIndex === 'number'
      ? buildingAtFace(shell.ranges, event.faceIndex)
      : null;

  const ghosted = focusedCode !== null;
  return (
    <>
      {shell === null ? null : (
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
              transparent={ghosted}
              opacity={ghosted ? ghostOpacity : 1}
              depthWrite={!ghosted}
            />
          </mesh>
          <lineSegments geometry={shell.outline}>
            <lineBasicMaterial
              vertexColors
              transparent={ghosted}
              opacity={ghosted ? ghostOpacity : 1}
            />
          </lineSegments>
        </>
      )}
      {focused === null ? null : (
        <>
          <mesh geometry={focused.walls} renderOrder={1} raycast={noRaycast}>
            <meshLambertMaterial
              color={buildingTop(focusedState)}
              transparent
              opacity={focusColors.wallOpacity}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
          <lineSegments geometry={focused.solid} renderOrder={2} raycast={noRaycast}>
            <lineBasicMaterial color={focusedRim} />
          </lineSegments>
          <lineSegments geometry={focused.roof} renderOrder={2} raycast={noRaycast}>
            <lineDashedMaterial color={focusedRim} dashSize={ROOF_DASH_M} gapSize={ROOF_GAP_M} />
          </lineSegments>
        </>
      )}
    </>
  );
}

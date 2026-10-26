import type { TwinBoundary, TwinZone } from '../api/types';

/**
 * The geometry of the digital twin, as plain numbers: nothing here imports three.js, so the scene (`src/twin/`) is the
 * only place that does and every calculation can be tested without a canvas. Positions in the layout are metres
 * [east, north] from the site centre; the scene's axes are the command center's (ADR-0020): three.js `x` is east, `y`
 * is up and `z` is minus north, so the right-handed frame keeps north away from the viewer.
 */

/** A rectangle on the ground, edges in metres east and north of the site centre. */
export interface GroundBox {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** A building: its footprint on the ground and the height of its shell. */
export interface Shell {
  code: string;
  name: string;
  box: GroundBox;
  heightM: number;
}

/** A building's share of the index buffer: the table the scene paints and picks by (SIM-18). */
export interface ShellRange {
  code: string;
  /** Position of the first index. */
  start: number;
  /** Number of indices. */
  count: number;
}

export interface ShellGeometry {
  /** x, y, z of every vertex. */
  positions: Float32Array;
  /** The unit normal of every vertex; each face has its own vertices, so the edges stay sharp. */
  normals: Float32Array;
  /** Triangles, counter-clockwise seen from outside. */
  indices: Uint32Array;
  /** Pairs of vertices (x, y, z each): the outline of every building, for a `LineSegments`. */
  edges: Float32Array;
  ranges: ShellRange[];
}

/** A building's footprint is its zone inset by this much on every side (ADR-0017, the command center's drawing rule). */
export const FOOTPRINT_INSET_M = 8;
/** The height of a building zone that has none: the command center's rule, in the lower half of its seed's 6 – 24 m. */
export const DEFAULT_BUILDING_HEIGHT_M = 12;

/** A position in the layout as a point of the scene: east to `+x`, up to `+y`, north to `−z`. */
export function sceneOf(east: number, north: number, up = 0): [number, number, number] {
  // `|| 0` turns the -0 that negating a zero gives into 0, so a position at the origin compares equal to one.
  return [east, up, -north || 0];
}

/**
 * The zone inset by `FOOTPRINT_INSET_M`, or the zone itself when a side is too short to inset. The same arithmetic as
 * `footprintOf` in `apps/simulator/src/twin-layout.ts`, which checks the devices with it; both tests pin the same numbers.
 */
export function footprintOf(zone: Pick<TwinZone, 'at' | 'size'>): GroundBox {
  const [east, north] = zone.at;
  const [width, depth] = zone.size;
  const inset =
    width > 2 * FOOTPRINT_INSET_M && depth > 2 * FOOTPRINT_INSET_M ? FOOTPRINT_INSET_M : 0;
  const halfWidth = width / 2 - inset;
  const halfDepth = depth / 2 - inset;
  return {
    west: east - halfWidth,
    east: east + halfWidth,
    south: north - halfDepth,
    north: north + halfDepth,
  };
}

/** The buildings of the layout, in its order; the other kinds of zone are flat and are not drawn by the spike. */
export function buildingShells(layout: { zones: readonly TwinZone[] }): Shell[] {
  return layout.zones
    .filter((zone) => zone.kind === 'building')
    .map((zone) => ({
      code: zone.code,
      name: zone.name,
      box: footprintOf(zone),
      heightM: zone.heightM ?? DEFAULT_BUILDING_HEIGHT_M,
    }));
}

type Vec3 = [number, number, number];

const VERTICES_PER_BUILDING = 20;
const INDICES_PER_BUILDING = 30;
const EDGE_FLOATS_PER_BUILDING = 12 * 2 * 3;

/**
 * Every building as a box without a floor: a top and four walls, 20 vertices and 30 indices each, in one set of
 * buffers (one mesh, however many buildings) with a second set for the outline. The corners go round the footprint
 * counter-clockwise seen from above (south-west, south-east, north-east, north-west), so the first wall is the south
 * one and the normals are `+z`, `+x`, `−z`, `−x`; the top is `+y`.
 */
export function buildShellGeometry(shells: readonly Shell[]): ShellGeometry {
  const positions = new Float32Array(shells.length * VERTICES_PER_BUILDING * 3);
  const normals = new Float32Array(shells.length * VERTICES_PER_BUILDING * 3);
  const indices = new Uint32Array(shells.length * INDICES_PER_BUILDING);
  const edges = new Float32Array(shells.length * EDGE_FLOATS_PER_BUILDING);
  const ranges: ShellRange[] = [];

  let vertex = 0;
  let index = 0;
  let edge = 0;

  const addQuad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, normal: Vec3) => {
    const first = vertex;
    for (const point of [a, b, c, d]) {
      positions.set(point, vertex * 3);
      normals.set(normal, vertex * 3);
      vertex += 1;
    }
    indices.set([first, first + 1, first + 2, first, first + 2, first + 3], index);
    index += 6;
  };
  const addEdge = (from: Vec3, to: Vec3) => {
    edges.set(from, edge);
    edges.set(to, edge + 3);
    edge += 6;
  };

  for (const shell of shells) {
    const { box, heightM: h } = shell;
    const [x0, , zSouth] = sceneOf(box.west, box.south);
    const [x1, , zNorth] = sceneOf(box.east, box.north);
    const ring: [number, number][] = [
      [x0, zSouth],
      [x1, zSouth],
      [x1, zNorth],
      [x0, zNorth],
    ];
    const start = index;

    // The top: north-west, south-west, south-east, north-east is counter-clockwise seen from above.
    const [nw, sw, se, ne] = [ring[3]!, ring[0]!, ring[1]!, ring[2]!];
    addQuad([nw[0], h, nw[1]], [sw[0], h, sw[1]], [se[0], h, se[1]], [ne[0], h, ne[1]], [0, 1, 0]);

    for (let i = 0; i < 4; i += 1) {
      const from = ring[i]!;
      const to = ring[(i + 1) % 4]!;
      const dx = to[0] - from[0];
      const dz = to[1] - from[1];
      const length = Math.hypot(dx, dz);
      // Outward for a ring that is counter-clockwise seen from above.
      const normal: Vec3 = [-dz / length || 0, 0, dx / length || 0];
      addQuad(
        [from[0], 0, from[1]],
        [to[0], 0, to[1]],
        [to[0], h, to[1]],
        [from[0], h, from[1]],
        normal,
      );
      addEdge([from[0], 0, from[1]], [to[0], 0, to[1]]);
      addEdge([from[0], h, from[1]], [to[0], h, to[1]]);
      addEdge([from[0], 0, from[1]], [from[0], h, from[1]]);
    }
    ranges.push({ code: shell.code, start, count: index - start });
  }

  return { positions, normals, indices, edges, ranges };
}

/**
 * The site boundary, a rounded rectangle, as a closed loop of points [x, z] in scene metres (the first point is not
 * repeated at the end). Each corner is an arc of `segmentsPerCorner + 1` points; a radius larger than half a side is
 * cut down to it, and a radius of 0 gives the four corners.
 */
export function boundaryRing(boundary: TwinBoundary, segmentsPerCorner = 6): [number, number][] {
  const { west, east, south, north } = boundary;
  const radius = Math.max(0, Math.min(boundary.radius, (east - west) / 2, (north - south) / 2));
  const toScene = (e: number, n: number): [number, number] => {
    const [x, , z] = sceneOf(e, n);
    return [x, z];
  };
  if (radius === 0) {
    return [toScene(west, south), toScene(east, south), toScene(east, north), toScene(west, north)];
  }
  // Counter-clockwise seen from above: the arc of each corner, from its start angle a quarter turn on.
  const corners: { centre: [number, number]; from: number }[] = [
    { centre: [west + radius, south + radius], from: Math.PI },
    { centre: [east - radius, south + radius], from: 1.5 * Math.PI },
    { centre: [east - radius, north - radius], from: 0 },
    { centre: [west + radius, north - radius], from: 0.5 * Math.PI },
  ];
  const points: [number, number][] = [];
  for (const { centre, from } of corners) {
    for (let step = 0; step <= segmentsPerCorner; step += 1) {
      const angle = from + (step / segmentsPerCorner) * (Math.PI / 2);
      points.push(
        toScene(centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)),
      );
    }
  }
  return points;
}

/**
 * The building a triangle belongs to, from the triangle's index in the merged mesh (what a pointer hit reports as
 * `faceIndex`): the range whose indices contain the triangle's first index. `null` for an index outside every range.
 */
export function buildingAtFace(ranges: readonly ShellRange[], faceIndex: number): string | null {
  const first = faceIndex * 3;
  const range = ranges.find(({ start, count }) => first >= start && first < start + count);
  return range === undefined ? null : range.code;
}

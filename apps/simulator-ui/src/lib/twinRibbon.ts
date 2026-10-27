import type { Point3 } from './twinFlow';

/**
 * A ribbon along a polyline that always faces the camera and keeps one width on the screen: the way the scene draws an
 * arc, since a line is one pixel wide in WebGL and a glow needs a width. The vertices are worked out here, in plain
 * numbers, each frame the scene is drawn; the scene copies them into a buffer. Nothing here imports three.js.
 */

/** A dash pattern in segments: `on` drawn, then `off` left out, repeating. */
export interface DashPattern {
  on: number;
  off: number;
}

/**
 * The triangles of a ribbon of `segments` pieces (`2 × (segments + 1)` vertices: the left and the right of each point), as
 * indices. With a pattern, the pieces that fall in an `off` stretch are left out.
 */
export function ribbonIndices(segments: number, dash: DashPattern | null): number[] {
  const indices: number[] = [];
  const period = dash === null ? 1 : Math.max(1, dash.on + dash.off);
  for (let piece = 0; piece < segments; piece += 1) {
    if (dash !== null && piece % period >= dash.on) continue;
    const a = 2 * piece;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return indices;
}

const length = (v: Point3): number => Math.hypot(v[0], v[1], v[2]);

const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** `v` of length 1, or `null` for a vector too short to have a direction. */
function unit(v: Point3): Point3 | null {
  const size = length(v);
  return size < 1e-9 ? null : [v[0] / size, v[1] / size, v[2] / size];
}

/**
 * Writes the vertices of the ribbon into `out` (three numbers each, left then right of every point, so
 * `points.length × 6` numbers). At each point the ribbon is as wide as `widthPx` pixels are at that point's distance from
 * the camera (`metresPerPixel` is the world size of one pixel at distance 1), and lies across the line's direction and
 * the direction to the camera, so it faces the viewer. A point where those directions coincide (looking along the line)
 * falls back to a horizontal side.
 */
export function writeRibbon(
  out: Float32Array,
  points: readonly Point3[],
  camera: Point3,
  metresPerPixel: number,
  widthPx: number,
): void {
  const last = points.length - 1;
  for (let i = 0; i <= last; i += 1) {
    const point = points[i] as Point3;
    const before = points[Math.max(0, i - 1)] as Point3;
    const after = points[Math.min(last, i + 1)] as Point3;
    const tangent: Point3 = [after[0] - before[0], after[1] - before[1], after[2] - before[2]];
    const toCamera: Point3 = [camera[0] - point[0], camera[1] - point[1], camera[2] - point[2]];
    const side =
      unit(cross(tangent, toCamera)) ?? unit(cross(tangent, [0, 1, 0])) ?? ([1, 0, 0] as Point3);
    const half = 0.5 * widthPx * metresPerPixel * length(toCamera);
    const at = i * 6;
    out[at] = point[0] - side[0] * half;
    out[at + 1] = point[1] - side[1] * half;
    out[at + 2] = point[2] - side[2] * half;
    out[at + 3] = point[0] + side[0] * half;
    out[at + 4] = point[1] + side[1] * half;
    out[at + 5] = point[2] + side[2] * half;
  }
}

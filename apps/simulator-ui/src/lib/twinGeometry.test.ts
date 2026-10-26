import { describe, expect, it } from 'vitest';
import { twinLayoutFixture } from '../api/fixtures/twinLayout';
import type { TwinLayout } from '../api/types';
import {
  boundaryRing,
  buildingShells,
  buildShellGeometry,
  DEFAULT_BUILDING_HEIGHT_M,
  footprintOf,
  sceneOf,
} from './twinGeometry';

const layout = twinLayoutFixture.layout as TwinLayout;
const boundary = layout.boundary;

describe('sceneOf', () => {
  it('puts east on x, up on y and north on minus z, the command center’s axes', () => {
    expect(sceneOf(175, 40, 14)).toEqual([175, 14, -40]);
    expect(sceneOf(-60, -110)).toEqual([-60, 0, 110]);
  });

  it('gives a plain zero at the origin, not minus zero', () => {
    const [x, y, z] = sceneOf(0, 0);
    expect([Object.is(x, 0), Object.is(y, 0), Object.is(z, 0)]).toEqual([true, true, true]);
  });
});

describe('footprintOf', () => {
  it('insets the zone by 8 m on every side, as the simulator does for the same zone', () => {
    expect(footprintOf({ at: [175, 40], size: [60, 46] })).toEqual({
      west: 153,
      east: 197,
      south: 25,
      north: 55,
    });
  });

  it('uses the zone itself when a side is too short to inset', () => {
    expect(footprintOf({ at: [0, 0], size: [16, 40] })).toEqual({
      west: -8,
      east: 8,
      south: -20,
      north: 20,
    });
  });
});

describe('buildingShells', () => {
  it('has one shell per building, in the layout’s order, and none for the other kinds of zone', () => {
    const shells = buildingShells(layout);
    expect(shells.map((shell) => shell.code)).toEqual(['BLD-LIB', 'BLD-DC']);
    expect(shells.map((shell) => shell.heightM)).toEqual([18, 14]);
    expect(shells[0]?.box).toEqual({ west: 13, east: 67, south: 103, north: 137 });
    expect(shells[1]?.box).toEqual({ west: 153, east: 197, south: 25, north: 55 });
  });

  it('draws a building that has no height at the command center’s default', () => {
    const [zone] = layout.zones.filter((z) => z.kind === 'building');
    const noHeight = { zones: [{ ...zone!, heightM: undefined }] };
    expect(buildingShells(noHeight)[0]?.heightM).toBe(DEFAULT_BUILDING_HEIGHT_M);
  });

  it('is empty for a campus with no building', () => {
    expect(buildingShells({ zones: [] })).toEqual([]);
  });
});

describe('buildShellGeometry', () => {
  const shells = buildingShells(layout);
  const geometry = buildShellGeometry(shells);
  const vertex = (i: number) => [
    geometry.positions[3 * i]!,
    geometry.positions[3 * i + 1]!,
    geometry.positions[3 * i + 2]!,
  ];
  const normal = (i: number) => [
    geometry.normals[3 * i]!,
    geometry.normals[3 * i + 1]!,
    geometry.normals[3 * i + 2]!,
  ];

  it('has 20 vertices, 30 indices and 12 outline segments per building, in one set of buffers', () => {
    expect(geometry.positions.length).toBe(2 * 20 * 3);
    expect(geometry.normals.length).toBe(2 * 20 * 3);
    expect(geometry.indices.length).toBe(2 * 30);
    expect(geometry.edges.length).toBe(2 * 12 * 2 * 3);
    expect(Math.max(...geometry.indices)).toBe(39);
  });

  it('says which indices are which building, without gaps', () => {
    expect(geometry.ranges).toEqual([
      { code: 'BLD-LIB', start: 0, count: 30 },
      { code: 'BLD-DC', start: 30, count: 30 },
    ]);
  });

  it('keeps every vertex between the ground and the roof and inside the footprint', () => {
    const [lib, dc] = shells as [(typeof shells)[number], (typeof shells)[number]];
    for (const [shell, first] of [
      [lib, 0],
      [dc, 20],
    ] as const) {
      for (let i = first; i < first + 20; i += 1) {
        const [x, y, z] = vertex(i) as [number, number, number];
        expect(x).toBeGreaterThanOrEqual(shell.box.west);
        expect(x).toBeLessThanOrEqual(shell.box.east);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(shell.heightM);
        expect(-z).toBeGreaterThanOrEqual(shell.box.south);
        expect(-z).toBeLessThanOrEqual(shell.box.north);
      }
    }
  });

  it('has unit normals: up for the top, then south, east, north and west for the walls', () => {
    for (let i = 0; i < 40; i += 1) {
      expect(Math.hypot(...normal(i))).toBeCloseTo(1, 6);
    }
    expect(normal(0)).toEqual([0, 1, 0]);
    expect(normal(4)).toEqual([0, 0, 1]);
    expect(normal(8)).toEqual([1, 0, 0]);
    expect(normal(12)).toEqual([0, 0, -1]);
    expect(normal(16)).toEqual([-1, 0, 0]);
  });

  it('winds every triangle counter-clockwise seen from outside, so it agrees with its normal', () => {
    for (let t = 0; t < geometry.indices.length; t += 3) {
      const [a, b, c] = [geometry.indices[t]!, geometry.indices[t + 1]!, geometry.indices[t + 2]!];
      const [pa, pb, pc] = [vertex(a), vertex(b), vertex(c)] as [number[], number[], number[]];
      const ab = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
      const ac = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
      const cross = [
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!,
      ];
      const n = normal(a);
      expect(cross[0]! * n[0]! + cross[1]! * n[1]! + cross[2]! * n[2]!).toBeGreaterThan(0);
    }
  });

  it('puts the outline of the Data Center on its footprint and its roof', () => {
    // The second building's edges start at 72 floats. Its first segment is the south-west corner to the south-east one.
    const first = Array.from(geometry.edges.slice(72, 78));
    expect(first).toEqual([153, 0, -25, 197, 0, -25]);
  });

  it('is empty, and has no ranges, for no building', () => {
    const none = buildShellGeometry([]);
    expect([none.positions.length, none.indices.length, none.edges.length]).toEqual([0, 0, 0]);
    expect(none.ranges).toEqual([]);
  });
});

describe('boundaryRing', () => {
  const ring = boundaryRing(boundary);

  it('is a loop of 4 corners of 7 points, all inside the boundary and touching its four sides', () => {
    expect(ring).toHaveLength(4 * 7);
    const xs = ring.map(([x]) => x);
    const zs = ring.map(([, z]) => z);
    expect(Math.min(...xs)).toBeCloseTo(boundary.west, 9);
    expect(Math.max(...xs)).toBeCloseTo(boundary.east, 9);
    // North is minus z.
    expect(Math.min(...zs)).toBeCloseTo(-boundary.north, 9);
    expect(Math.max(...zs)).toBeCloseTo(-boundary.south, 9);
  });

  it('rounds each corner with an arc of the boundary’s radius', () => {
    // The first corner is south-west: its centre is one radius in from both sides.
    const centre = [boundary.west + boundary.radius, -(boundary.south + boundary.radius)];
    for (const [x, z] of ring.slice(0, 7)) {
      expect(Math.hypot(x - centre[0]!, z - centre[1]!)).toBeCloseTo(boundary.radius, 9);
    }
  });

  it('is the four corners for a radius of 0, and cuts a radius down to half a side', () => {
    expect(boundaryRing({ ...boundary, radius: 0 })).toEqual([
      [-282, 277],
      [228, 277],
      [228, -247],
      [-282, -247],
    ]);
    const square = boundaryRing({ west: 0, east: 10, south: 0, north: 10, radius: 99 });
    expect(Math.min(...square.map(([x]) => x))).toBeCloseTo(0, 9);
    expect(Math.max(...square.map(([x]) => x))).toBeCloseTo(10, 9);
  });
});

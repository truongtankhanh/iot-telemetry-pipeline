import type { TwinLayout, TwinZone } from '../api/types';
import { boundaryRing, footprintOf } from './twinGeometry';
import { HOME_TILT_DEG, HOME_YAW_DEG } from './twinCamera';

/**
 * The flat plan of the campus (frame 16): what the page draws while the 3D code loads, from the same layout and with the
 * same metres, so the live pins already stand where they will stand in the scene. An orthographic view from the home
 * camera's direction (south-east, 45° round, 55° from vertical), so the plan looks like the scene that replaces it. Pure:
 * the page draws the polygons as SVG and puts the pins over it by their share of the picture.
 */

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Empty space round the boundary, in the plan's own units (metres of the projected plane). */
export const PLAN_PADDING = 16;

/**
 * A point of the layout (metres east and north of the site centre, and `up` metres) on the plan's plane, in metres right
 * of and below the centre of the view. The camera's right and up vectors for a camera `yaw` round from south and `tilt`
 * from vertical, as `homeView` places it: right = (cos yaw, 0, −sin yaw), up = (−sin yaw · cos tilt, sin tilt, −cos yaw · cos tilt),
 * with the scene's `z` being minus north.
 */
export function planPoint(
  east: number,
  north: number,
  up: number,
  yawDeg: number = HOME_YAW_DEG,
  tiltDeg: number = HOME_TILT_DEG,
): [number, number] {
  const yaw = toRadians(yawDeg);
  const tilt = toRadians(tiltDeg);
  const right = east * Math.cos(yaw) + north * Math.sin(yaw);
  const raised =
    -east * Math.sin(yaw) * Math.cos(tilt) +
    north * Math.cos(yaw) * Math.cos(tilt) +
    up * Math.sin(tilt);
  // The picture's y grows downwards.
  return [right, -raised];
}

export interface PlanShape {
  code: string;
  /** The zone's kind (`building`, `parking`, `gate`, `outdoor`, `utility`, `water`): the page picks a fill by it. */
  kind: string;
  points: [number, number][];
}

export interface Plan {
  /** The SVG's `viewBox`, in the plan's units. */
  viewBox: { x: number; y: number; width: number; height: number };
  /** Width over height of the viewBox: the page keeps this ratio so a share of the picture is a share of the box. */
  aspect: number;
  /** The site boundary, a closed loop. */
  boundary: [number, number][];
  /** Every zone that is not a building, flat, at its full size. */
  zones: PlanShape[];
  /** The buildings' footprints (the zone inset by 8 m, the command center's rule). */
  buildings: PlanShape[];
  /** A point of the layout as a share (0 to 1) of the picture's width and height, for a DOM overlay. */
  share(east: number, north: number, up?: number): { x: number; y: number };
}

const corners = (zone: Pick<TwinZone, 'at' | 'size'>): [number, number][] => {
  const [east, north] = zone.at;
  const [width, depth] = zone.size;
  return [
    [east - width / 2, north - depth / 2],
    [east + width / 2, north - depth / 2],
    [east + width / 2, north + depth / 2],
    [east - width / 2, north + depth / 2],
  ];
};

/** The plan of the layout's zones and boundary, seen from `yawDeg` round from south. */
export function planOf(
  layout: Pick<TwinLayout, 'zones' | 'boundary'>,
  yawDeg: number = HOME_YAW_DEG,
): Plan {
  const project = (east: number, north: number): [number, number] =>
    planPoint(east, north, 0, yawDeg);
  const ring = boundaryRing(layout.boundary).map(([east, minusNorth]) =>
    project(east, -minusNorth),
  );

  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const minX = Math.min(...xs) - PLAN_PADDING;
  const minY = Math.min(...ys) - PLAN_PADDING;
  const width = Math.max(...xs) + PLAN_PADDING - minX;
  const height = Math.max(...ys) + PLAN_PADDING - minY;

  const zones: PlanShape[] = [];
  const buildings: PlanShape[] = [];
  for (const zone of layout.zones) {
    if (zone.kind === 'building') {
      const box = footprintOf(zone);
      buildings.push({
        code: zone.code,
        kind: zone.kind,
        points: [
          project(box.west, box.south),
          project(box.east, box.south),
          project(box.east, box.north),
          project(box.west, box.north),
        ],
      });
    } else {
      zones.push({
        code: zone.code,
        kind: zone.kind,
        points: corners(zone).map(([east, north]) => project(east, north)),
      });
    }
  }

  return {
    viewBox: { x: minX, y: minY, width, height },
    aspect: width / height,
    boundary: ring,
    zones,
    buildings,
    share(east, north, up = 0) {
      const [x, y] = planPoint(east, north, up, yawDeg);
      return { x: (x - minX) / width, y: (y - minY) / height };
    },
  };
}

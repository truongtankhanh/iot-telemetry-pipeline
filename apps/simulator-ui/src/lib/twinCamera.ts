import type { TwinBoundary } from '../api/types';
import type { GroundBox } from './twinGeometry';

/**
 * The camera of the digital twin, as numbers: the limits of the command center's brief and the home view, which are the
 * same ones so the two twins can be compared (ADR-0012, decision 2). Nothing here imports three.js; the scene's
 * `CameraRig` applies them. Positions are in scene metres: `x` east, `y` up, `z` minus north.
 */

/** The lens, shared by the canvas and the home fit so they cannot disagree (the command center's `HOME_FOV_DEG`). */
export const HOME_FOV_DEG = 50;
/** The home view looks from the south-east, 45° round from south, 55° from the vertical. */
export const HOME_YAW_DEG = 45;
export const HOME_TILT_DEG = 55;
/** How much of the view is left empty around the campus at home. */
export const HOME_MARGIN = 0.08;

/** The camera never goes flatter than 78° from vertical (12° above the ground) nor steeper than 20°. */
export const TILT_MIN_DEG = 20;
export const TILT_MAX_DEG = 78;
/** The campus level's distance limits, in metres from the target (ADR-0020, "Camera limits"). */
export const MIN_DISTANCE_M = 60;
export const MAX_DISTANCE_M = 900;
/** The target stays inside the site boundary plus this much. */
export const TARGET_MARGIN_M = 40;
/** The target may be lifted to a roof, no higher than the command center allows. */
export const TARGET_MAX_HEIGHT_M = 60;

/** The lens settings that do not depend on the layout: `far` reaches past the longest distance and the campus's radius. */
export const LENS = { fov: HOME_FOV_DEG, near: 1, far: 2500 } as const;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** The tilt limits as polar angles, which is what three's `OrbitControls` takes (0 looks straight down). */
export function polarLimitsRad(): { min: number; max: number } {
  return { min: toRadians(TILT_MIN_DEG), max: toRadians(TILT_MAX_DEG) };
}

/** The target pulled back into the boundary plus 40 m, and not under the ground or above the roof limit. */
export function clampTarget(
  target: readonly [number, number, number],
  boundary: TwinBoundary,
): [number, number, number] {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return [
    clamp(target[0], boundary.west - TARGET_MARGIN_M, boundary.east + TARGET_MARGIN_M),
    clamp(target[1], 0, TARGET_MAX_HEIGHT_M),
    // North is minus z.
    clamp(target[2], -(boundary.north + TARGET_MARGIN_M), -(boundary.south - TARGET_MARGIN_M)),
  ];
}

/**
 * How far the camera must be for a sphere of `radius` to fit the lens with the home margin, inside the campus distance
 * limits. The narrower of the two half-angles decides: a tall canvas is limited by its width.
 */
export function fitDistance(radius: number, aspect: number, fovDeg: number = HOME_FOV_DEG): number {
  const halfVertical = toRadians(fovDeg) / 2;
  const halfAngle = Math.min(halfVertical, Math.atan(Math.tan(halfVertical) * aspect));
  const fit = (radius * (1 + HOME_MARGIN)) / Math.sin(halfAngle);
  return Math.min(MAX_DISTANCE_M, Math.max(MIN_DISTANCE_M, fit));
}

/**
 * The first view: looking at the middle of the boundary from the south-east, far enough that the whole boundary is in
 * the picture with a margin (a circle round the boundary's rectangle, so the fit is a little generous), inside the
 * campus distance limits. `aspect` is the canvas's width over its height.
 */
export function homeView(
  boundary: TwinBoundary,
  aspect: number,
  fovDeg: number = HOME_FOV_DEG,
): { target: [number, number, number]; position: [number, number, number]; distance: number } {
  const target: [number, number, number] = [
    (boundary.west + boundary.east) / 2,
    0,
    -(boundary.south + boundary.north) / 2 || 0,
  ];
  const radius = Math.hypot(boundary.east - boundary.west, boundary.north - boundary.south) / 2;
  const distance = fitDistance(radius, aspect, fovDeg);

  const tilt = toRadians(HOME_TILT_DEG);
  const yaw = toRadians(HOME_YAW_DEG);
  // From the target towards the camera: south is +z, east is +x.
  const position: [number, number, number] = [
    target[0] + distance * Math.sin(tilt) * Math.sin(yaw),
    target[1] + distance * Math.cos(tilt),
    target[2] + distance * Math.sin(tilt) * Math.cos(yaw),
  ];
  return { target, position, distance };
}

// ---- Presets and nudges (SIM-18) ----

/** Where the camera is and what it looks at, in scene metres. */
export interface CameraView {
  position: [number, number, number];
  target: [number, number, number];
}

/**
 * The presets that need nothing but the boundary. _Top_ is the nearest to overhead the tilt limit allows: 20° from
 * vertical, the same yaw and distance as the home view, so the limit the design set stays one. The _Building_ view is not
 * a preset: it is made for one building (`CameraTarget`).
 */
export type CameraPreset = 'campus' | 'top';

/** The camera `distance` from `target`, `tiltDeg` from vertical and `yawDeg` round from south towards east. */
function orbitPosition(
  target: readonly [number, number, number],
  distance: number,
  tiltDeg: number,
  yawDeg: number,
): [number, number, number] {
  const tilt = toRadians(tiltDeg);
  const yaw = toRadians(yawDeg);
  return [
    target[0] + distance * Math.sin(tilt) * Math.sin(yaw),
    target[1] + distance * Math.cos(tilt),
    target[2] + distance * Math.sin(tilt) * Math.cos(yaw),
  ];
}

/** The overhead preset: the home view's target, yaw and distance at the steepest tilt the limits allow. */
export function topView(boundary: TwinBoundary, aspect: number): CameraView {
  const home = homeView(boundary, aspect);
  return {
    target: home.target,
    position: orbitPosition(home.target, home.distance, TILT_MIN_DEG, HOME_YAW_DEG),
  };
}

export function presetView(
  preset: CameraPreset,
  boundary: TwinBoundary,
  aspect: number,
): CameraView {
  if (preset === 'top') return topView(boundary, aspect);
  const home = homeView(boundary, aspect);
  return { target: home.target, position: home.position };
}

/** What a view of one building has to hold: its footprint united with its assets (`buildingBounds`), and its height. */
export interface BuildingFocus {
  box: GroundBox;
  heightM: number;
}

/** Where the camera can be sent: a preset, or one building. */
export type CameraTarget = CameraPreset | { building: BuildingFocus };

/**
 * The view of one building: the home view's yaw and tilt, looking at the middle of the box at half the building's height,
 * far enough that the box and the height fit the lens, inside the same distance, tilt and target limits as the campus.
 * The command center has limits of its own per level; they are not copied.
 */
export function buildingView(
  focus: BuildingFocus,
  boundary: TwinBoundary,
  aspect: number,
): CameraView {
  const { box, heightM } = focus;
  const east = (box.west + box.east) / 2;
  const north = (box.south + box.north) / 2;
  const target = clampTarget([east, heightM / 2, -north || 0], boundary);
  const radius = Math.hypot(box.east - box.west, box.north - box.south, heightM) / 2;
  return {
    target,
    position: orbitPosition(target, fitDistance(radius, aspect), HOME_TILT_DEG, HOME_YAW_DEG),
  };
}

/** The view for a flight's destination. */
export function viewFor(target: CameraTarget, boundary: TwinBoundary, aspect: number): CameraView {
  return typeof target === 'string'
    ? presetView(target, boundary, aspect)
    : buildingView(target.building, boundary, aspect);
}

/**
 * What the camera buttons and the keys do. Rotating turns the campus as the button's arrow says (_left_ turns it
 * counter-clockwise seen from above, so the camera moves clockwise), panning slides the target over the ground in the
 * direction of the arrow.
 */
export type CameraNudge =
  | 'rotate-left'
  | 'rotate-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'pan-down';

/** One step of a rotation, one step of a zoom (the distance is multiplied by it or divided by it), one step of a pan. */
export const ROTATE_STEP_DEG = 15;
export const ZOOM_STEP = 0.8;
/** A pan moves the target by this share of the distance to it. */
export const PAN_STEP = 0.1;

/**
 * The view after one nudge, kept inside the limits: the tilt between 20° and 78°, the distance between 60 and 900 m,
 * the target inside the boundary plus 40 m (the position follows the target, so the angle and the distance are kept).
 */
export function nudgeView(
  view: CameraView,
  boundary: TwinBoundary,
  nudge: CameraNudge,
): CameraView {
  const [dx, dy, dz] = [
    view.position[0] - view.target[0],
    view.position[1] - view.target[1],
    view.position[2] - view.target[2],
  ];
  let distance = Math.hypot(dx, dy, dz);
  // 0 looks straight down; `atan2` gives the yaw from south (+z) towards east (+x), as `orbitPosition` takes it.
  let tilt =
    distance === 0 ? toRadians(HOME_TILT_DEG) : Math.acos(Math.min(1, Math.max(-1, dy / distance)));
  let yaw = Math.atan2(dx, dz);
  let target: [number, number, number] = [...view.target];

  switch (nudge) {
    case 'rotate-left':
      yaw -= toRadians(ROTATE_STEP_DEG);
      break;
    case 'rotate-right':
      yaw += toRadians(ROTATE_STEP_DEG);
      break;
    case 'zoom-in':
      distance *= ZOOM_STEP;
      break;
    case 'zoom-out':
      distance /= ZOOM_STEP;
      break;
    default: {
      const step = distance * PAN_STEP;
      // On the ground: to the right of the view, and away from the camera.
      const right: [number, number] = [Math.cos(yaw), -Math.sin(yaw)];
      const away: [number, number] = [-Math.sin(yaw), -Math.cos(yaw)];
      const sign = nudge === 'pan-left' || nudge === 'pan-down' ? -1 : 1;
      const along = nudge === 'pan-left' || nudge === 'pan-right' ? right : away;
      target = [target[0] + sign * step * along[0], target[1], target[2] + sign * step * along[1]];
    }
  }

  tilt = Math.min(toRadians(TILT_MAX_DEG), Math.max(toRadians(TILT_MIN_DEG), tilt));
  distance = Math.min(MAX_DISTANCE_M, Math.max(MIN_DISTANCE_M, distance));
  target = clampTarget(target, boundary);
  return {
    target,
    position: orbitPosition(target, distance, (tilt * 180) / Math.PI, (yaw * 180) / Math.PI),
  };
}

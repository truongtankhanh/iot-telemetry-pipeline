import type { TwinBoundary } from '../api/types';

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
  const halfVertical = toRadians(fovDeg) / 2;
  // The narrower of the two half-angles decides: a tall canvas is limited by its width.
  const halfAngle = Math.min(halfVertical, Math.atan(Math.tan(halfVertical) * aspect));
  const fit = (radius * (1 + HOME_MARGIN)) / Math.sin(halfAngle);
  const distance = Math.min(MAX_DISTANCE_M, Math.max(MIN_DISTANCE_M, fit));

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

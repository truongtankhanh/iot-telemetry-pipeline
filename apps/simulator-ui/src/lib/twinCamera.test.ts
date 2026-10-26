import { describe, expect, it } from 'vitest';
import { twinLayoutFixture } from '../api/fixtures/twinLayout';
import type { TwinLayout } from '../api/types';
import {
  clampTarget,
  HOME_TILT_DEG,
  homeView,
  MAX_DISTANCE_M,
  MIN_DISTANCE_M,
  polarLimitsRad,
  TILT_MAX_DEG,
  TILT_MIN_DEG,
} from './twinCamera';

const boundary = (twinLayoutFixture.layout as TwinLayout).boundary;
const degrees = (radians: number) => (radians * 180) / Math.PI;

describe('polarLimitsRad', () => {
  it('is the tilt limits of the brief, 20° and 78° from the vertical, in radians', () => {
    const { min, max } = polarLimitsRad();
    expect(degrees(min)).toBeCloseTo(TILT_MIN_DEG, 9);
    expect(degrees(max)).toBeCloseTo(TILT_MAX_DEG, 9);
    expect([TILT_MIN_DEG, TILT_MAX_DEG]).toEqual([20, 78]);
  });
});

describe('clampTarget', () => {
  it('leaves a target inside the boundary alone', () => {
    expect(clampTarget([100, 10, -40], boundary)).toEqual([100, 10, -40]);
  });

  it('pulls a target back to the boundary plus 40 m on every side', () => {
    // East 228 + 40, west -282 - 40; north 247 + 40 is z -287, south -277 - 40 is z 317.
    expect(clampTarget([900, 0, 0], boundary)[0]).toBe(268);
    expect(clampTarget([-900, 0, 0], boundary)[0]).toBe(-322);
    expect(clampTarget([0, 0, -900], boundary)[2]).toBe(-287);
    expect(clampTarget([0, 0, 900], boundary)[2]).toBe(317);
  });

  it('keeps the target off the ground and below the roof limit', () => {
    expect(clampTarget([0, -5, 0], boundary)[1]).toBe(0);
    expect(clampTarget([0, 500, 0], boundary)[1]).toBe(60);
  });
});

describe('homeView', () => {
  const home = homeView(boundary, 16 / 9);
  const [dx, dy, dz] = [
    home.position[0] - home.target[0],
    home.position[1] - home.target[1],
    home.position[2] - home.target[2],
  ];

  it('looks at the middle of the boundary, on the ground', () => {
    expect(home.target).toEqual([-27, 0, 15]);
  });

  it('is inside the campus distance limits and says how far it is', () => {
    expect(home.distance).toBeGreaterThanOrEqual(MIN_DISTANCE_M);
    expect(home.distance).toBeLessThanOrEqual(MAX_DISTANCE_M);
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(home.distance, 6);
  });

  it('is at the home tilt, inside the limits, and to the south-east of the target', () => {
    expect(degrees(Math.acos(dy / home.distance))).toBeCloseTo(HOME_TILT_DEG, 6);
    expect(HOME_TILT_DEG).toBeGreaterThanOrEqual(TILT_MIN_DEG);
    expect(HOME_TILT_DEG).toBeLessThanOrEqual(TILT_MAX_DEG);
    // East is +x and south is +z.
    expect(dx).toBeGreaterThan(0);
    expect(dz).toBeGreaterThan(0);
    expect(dx).toBeCloseTo(dz, 6);
  });

  it('stands further back for a narrower canvas, up to the limit', () => {
    const wide = homeView({ ...boundary, west: -60, east: 60, south: -60, north: 60 }, 16 / 9);
    const narrow = homeView({ ...boundary, west: -60, east: 60, south: -60, north: 60 }, 0.5);
    expect(narrow.distance).toBeGreaterThan(wide.distance);
    expect(homeView(boundary, 0.1).distance).toBe(MAX_DISTANCE_M);
  });

  it('never comes closer than the minimum, for a tiny site', () => {
    const tiny = homeView({ west: -1, east: 1, south: -1, north: 1, radius: 0 }, 16 / 9);
    expect(tiny.distance).toBe(MIN_DISTANCE_M);
  });
});

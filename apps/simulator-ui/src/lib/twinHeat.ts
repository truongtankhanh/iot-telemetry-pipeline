import { floorCells, type GroundBox, sceneOf } from './twinGeometry';
import { type TwinPin, TEMPERATURE_METRIC } from './twinPins';

/**
 * The heat floor of the building in focus, as plain data (SIM-20): which devices feed it, the temperature on every square
 * of the floor interpolated between them, the colour of each square on the command center's ramp, and the words that say
 * what the picture is. Nothing here imports three.js or React. **The floor is a drawing aid, not a measurement**: the
 * legend says "interpolated", and a building with nothing to interpolate is hatched, never tinted.
 *
 * The ramp and its scale are the command center's (ops-command-center at `0899c86`: `apps/console/src/styles/tokens.css`,
 * `--heat-0` … `--heat-5`; `docs/design/v2/asset-classes.md`, "Heat overlay": a fixed 19 – 27 °C scale, clamped, six
 * stops evenly spaced, linear in sRGB). This repository does not check them. They are copied, not read: the same six values
 * are in `src/styles/tokens.css` for the DOM legend, and a test is what notices the two drifting apart.
 */

/** The ends of the scale: a temperature outside them is coloured at the nearest end, and its number is still the real one. */
export const HEAT_MIN_C = 19;
export const HEAT_MAX_C = 27;

/** The six stops of the ramp, darkest to brightest, as `0xRRGGBB`. */
export const HEAT_STOPS: readonly number[] = [
  0x132b50, 0x1c3d6f, 0x22539c, 0x266cd5, 0x5292f2, 0x9bc3ff,
];

/** One square of the floor is about this many metres on a side. */
export const HEAT_CELL_M = 3;
/** The distance between the lines of the hatch, in metres. */
export const HATCH_SPACING_M = 2.5;
/**
 * The heights of the layers of the floor, in scene metres, a few centimetres apart so that none is drawn into another (the
 * site's ground is at −0.1 and its outline at 0.05): the plain floor, the coloured squares on it, the hatch over it.
 */
export const FLOOR_Y_M = 0.08;
export const HEAT_Y_M = 0.12;
const HATCH_Y_M = 0.16;

/** Where a temperature stands on the scale: 0 at `HEAT_MIN_C` and below, 1 at `HEAT_MAX_C` and above. */
export function rampT(celsius: number): number {
  if (!Number.isFinite(celsius)) return 0;
  return Math.min(1, Math.max(0, (celsius - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C)));
}

const channel = (hex: number, shift: number) => (hex >> shift) & 0xff;

/** The colour at `t` (0 – 1) on the ramp: the six stops sit evenly at 0, 0.2 … 1, and the colour is linear in sRGB between them. */
export function rampColor(t: number): number {
  const last = HEAT_STOPS.length - 1;
  const at = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * last;
  const index = Math.min(last - 1, Math.floor(at));
  const share = at - index;
  const from = HEAT_STOPS[index] ?? 0;
  const to = HEAT_STOPS[index + 1] ?? from;
  const mix = (shift: number) =>
    Math.round(channel(from, shift) + (channel(to, shift) - channel(from, shift)) * share);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/**
 * What the floor can say:
 * - `interpolated`: two or more sensors report, and the floor is interpolated between them;
 * - `single`: one reports, so the floor is one tint;
 * - `silent`: the building has a temperature metric but no device that has it is reporting;
 * - `none`: no device of the building has a temperature metric at all (the Innovation Hub's meter measures power).
 * The last two are hatched.
 */
export type HeatStatus = 'interpolated' | 'single' | 'silent' | 'none';

/** A device that feeds the floor, for the text twin; the value is rounded to a tenth of a degree. */
export interface HeatSensor {
  id: string;
  name: string;
  celsius: number;
  /** [east, north] metres from the site centre. */
  at: [number, number];
}

export interface HeatModel {
  /** The building's code: the key `Stable` keeps the model by. */
  id: string;
  status: HeatStatus;
  /** The floor: the building's footprint. */
  box: GroundBox;
  cols: number;
  rows: number;
  /** The colour of each square, row by row from the south-west corner (`0xRRGGBB`); empty when the floor is hatched. */
  colors: number[];
  sensors: HeatSensor[];
  /** What the legend and the card say about the floor, in one sentence. */
  words: string;
}

const tenth = (value: number) => Math.round(value * 10) / 10;

/** A pin's place on the ground, in metres [east, north] (its stem stands on the floor). */
function groundOf(pin: Pick<TwinPin, 'stemBase'>): [number, number] {
  const [east, , z] = pin.stemBase;
  return [east, -z || 0];
}

/**
 * The devices of a building that feed its floor: those with a number for `temperature_c` that are reporting. A device that
 * is paused, stopped or silent, and every device while the link to the simulator is lost, is dark (`state: 'stale'`) and does
 * not count: the command center's "fresh sources only" rule.
 */
export function heatSources(pins: readonly TwinPin[], zone: string): HeatSensor[] {
  return pins
    .filter((pin) => pin.zone === zone && pin.temperatureC !== null && pin.state !== 'stale')
    .map((pin) => ({
      id: pin.id,
      name: pin.name,
      celsius: tenth(pin.temperatureC ?? 0),
      at: groundOf(pin),
    }));
}

/** The sentence under the legend, for a status and the number of sensors behind it. */
export function heatWords(status: HeatStatus, sensors: number): string {
  switch (status) {
    case 'interpolated':
      return `The floor is interpolated between ${sensors} sensors, not measured.`;
    case 'single':
      return 'The floor is interpolated from 1 sensor, so it is one tint: not measured.';
    case 'silent':
      return 'No recent temperature: no sensor in this building is reporting.';
    case 'none':
      return 'No temperature data: no device in this building measures it.';
  }
}

/**
 * The temperature at a point, by inverse-distance weighting (power 2) of the sensors: at a sensor it is that sensor's value,
 * far from all of them it is their weighted mean, and it never leaves the range the sensors span.
 */
export function interpolate(at: readonly [number, number], sensors: readonly HeatSensor[]): number {
  let weights = 0;
  let total = 0;
  for (const sensor of sensors) {
    const squared = (at[0] - sensor.at[0]) ** 2 + (at[1] - sensor.at[1]) ** 2;
    if (squared < 1e-6) return sensor.celsius;
    weights += 1 / squared;
    total += sensor.celsius / squared;
  }
  return weights === 0 ? Number.NaN : total / weights;
}

/**
 * The floor of one building: the status, the sensors, the colour of each square and the words. Values are rounded to a tenth
 * of a degree before they become colours, so a reading that does not move a square leaves the model equal to the last one
 * (`Stable` then hands the scene the same object and no frame is asked for).
 */
export function twinHeat(pins: readonly TwinPin[], zone: string, box: GroundBox): HeatModel {
  const sensors = heatSources(pins, zone);
  const hasMetric = pins.some(
    (pin) =>
      pin.zone === zone && pin.readings.some((reading) => reading.metric === TEMPERATURE_METRIC),
  );
  const status: HeatStatus =
    sensors.length >= 2
      ? 'interpolated'
      : sensors.length === 1
        ? 'single'
        : hasMetric
          ? 'silent'
          : 'none';
  const grid = floorCells(box, HEAT_CELL_M);
  const colors =
    sensors.length === 0
      ? []
      : grid.cells.map((cell) =>
          rampColor(rampT(tenth(interpolate([cell.east, cell.north], sensors)))),
        );
  return {
    id: zone,
    status,
    box,
    cols: grid.cols,
    rows: grid.rows,
    colors,
    sensors,
    words: heatWords(status, sensors.length),
  };
}

/**
 * The lines of the hatch over a box, as pairs of points in scene metres (`x, y, z` each): 45° lines `spacingM` apart, clipped
 * to the box, over the coloured squares' height. A box with no area has none.
 */
export function hatchLines(box: GroundBox, spacingM: number = HATCH_SPACING_M): number[] {
  const step = Math.max(0.5, spacingM);
  const lines: number[] = [];
  // A line is `east - north = c`; it crosses the box where both coordinates are inside it.
  for (let c = box.west - box.north; c <= box.east - box.south; c += step) {
    const low = Math.max(box.south, box.west - c);
    const high = Math.min(box.north, box.east - c);
    if (low >= high) continue;
    lines.push(...sceneOf(c + low, low, HATCH_Y_M), ...sceneOf(c + high, high, HATCH_Y_M));
  }
  return lines;
}

/** The two triangles of a quad whose corners are listed south-west, south-east, north-east, north-west. */
export const QUAD_INDICES: readonly number[] = [0, 1, 2, 0, 2, 3];

/**
 * The four corners of a flat box at height `y`, as `x, y, z` each, south-west first and counter-clockwise seen from above
 * (so the quad faces up with `QUAD_INDICES`).
 */
export function quadPositions(box: GroundBox, y: number): number[] {
  return [
    ...sceneOf(box.west, box.south, y),
    ...sceneOf(box.east, box.south, y),
    ...sceneOf(box.east, box.north, y),
    ...sceneOf(box.west, box.north, y),
  ];
}

/**
 * The squares of a floor as one set of quads, four vertices and six indices each, in the order of `HeatModel.colors` (row by
 * row from the south-west corner): the scene paints vertex `4 * i … 4 * i + 3` with colour `i`.
 */
export function heatQuads(box: GroundBox): {
  positions: number[];
  indices: number[];
  cells: number;
} {
  const { cells } = floorCells(box, HEAT_CELL_M);
  const positions: number[] = [];
  const indices: number[] = [];
  cells.forEach((cell, index) => {
    positions.push(...quadPositions(cell.box, HEAT_Y_M));
    indices.push(...QUAD_INDICES.map((corner) => index * 4 + corner));
  });
  return { positions, indices, cells: cells.length };
}

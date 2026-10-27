import type { TwinLayout } from '../api/types';
import { type FaultVisuals, type HubChip, type HubStatus, NO_FAULT } from './twinFaults';
import { sceneOf } from './twinGeometry';
import type { TwinPin } from './twinPins';

/**
 * The data flow of the twin as plain data: the logical Pipeline hub, and one arc from each pin to it. The scene
 * (`src/twin/`) only draws what this hands it. Nothing here imports three.js or React.
 */

export type Point3 = [number, number, number];

/** How high the hub floats, in metres: above every roof, since the pipeline has no place on the campus. */
export const HUB_HEIGHT_M = 80;

/** The hub stands over the middle of the site boundary: the layout has no place for it, and a place would be a claim. */
export function hubAnchor(layout: Pick<TwinLayout, 'boundary'>): Point3 {
  const { west, east, south, north } = layout.boundary;
  return sceneOf((west + east) / 2, (south + north) / 2, HUB_HEIGHT_M);
}

/**
 * How an arc is drawn. `flowing` is cyan (energy moving), `warn` amber (an anomaly or an open alert), `off` a dim dashed
 * wire (the device does not report), `bad` red and dashed (the hub is down, or the link is cut): the same words as
 * Topology's edges, so the two pages' keys agree.
 */
export type ArcLook = 'flowing' | 'warn' | 'off' | 'bad';

/** An arc carries light, and dots, only in these looks. */
export const isLit = (look: ArcLook): boolean => look === 'flowing' || look === 'warn';

export interface TwinArc {
  /** The id of the device whose pin the arc leaves: the key of the arc, and of the pulses that draw its dots. */
  id: string;
  /** The curve, in scene metres, from the pin to the hub. */
  points: Point3[];
  look: ArcLook;
  /** Drop: drawn with gaps. */
  gaps: boolean;
  /** Delay: how many milliseconds a dot is slower. */
  slow: number;
}

export interface HubModel {
  anchor: Point3;
  status: HubStatus;
  chips: HubChip[];
  /** A cross at the hub while a malformed fault is on. */
  cross: { reasons: string[] } | null;
}

export interface TwinFlow {
  hub: HubModel;
  arcs: TwinArc[];
}

const ARC_SEGMENTS = 24;
/** An arc rises this share of its horizontal length above the straight line, at least `MIN_LIFT_M`. */
const LIFT_RATIO = 0.3;
const MIN_LIFT_M = 20;

/**
 * A quadratic Bézier from `from` to `to`, `segments + 1` points, its middle raised by `lift` metres so that it clears the
 * roofs between a pin and the hub. Endpoints are exact.
 */
export function arcPoints(
  from: Point3,
  to: Point3,
  lift: number,
  segments = ARC_SEGMENTS,
): Point3[] {
  const control: Point3 = [
    (from[0] + to[0]) / 2,
    (from[1] + to[1]) / 2 + lift,
    (from[2] + to[2]) / 2,
  ];
  const steps = Math.max(1, Math.floor(segments));
  const points: Point3[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    points.push([
      a * from[0] + b * control[0] + c * to[0],
      a * from[1] + b * control[1] + c * to[1],
      a * from[2] + b * control[2] + c * to[2],
    ]);
  }
  return points;
}

/** The lift of the arc between two points: a share of how far apart they are on the ground. */
export const liftOf = (from: Point3, to: Point3): number =>
  Math.max(MIN_LIFT_M, LIFT_RATIO * Math.hypot(to[0] - from[0], to[2] - from[2]));

function lookOf(pin: Pick<TwinPin, 'state'>, hub: HubStatus, visuals: FaultVisuals): ArcLook {
  // A cut link and a hub that is down take every arc, whatever the device is doing (the table: "every arc turns red and
  // dashed", "red dashed").
  if (visuals.linkLoss || hub.state === 'down' || hub.state === 'no-link') return 'bad';
  switch (pin.state) {
    case 'healthy':
      return 'flowing';
    case 'anomaly':
      return 'warn';
    case 'down':
      return 'bad';
    case 'stale':
      return 'off';
  }
}

/**
 * The hub and the arcs, from the pins (whose `state` already counts an open alert as an anomaly), the status of the
 * pipeline and the visuals of the faults. One arc for every pin, in the pins' order.
 */
export function twinFlow(
  layout: Pick<TwinLayout, 'boundary'>,
  pins: readonly TwinPin[],
  hub: HubStatus,
  visuals: FaultVisuals,
): TwinFlow {
  const anchor = hubAnchor(layout);
  const arcs = pins.map((pin): TwinArc => {
    const fault = visuals.byDevice.get(pin.id) ?? NO_FAULT;
    return {
      id: pin.id,
      points: arcPoints(pin.anchor, anchor, liftOf(pin.anchor, anchor)),
      look: lookOf(pin, hub, visuals),
      gaps: fault.gaps,
      slow: fault.slow,
    };
  });
  return {
    hub: { anchor, status: hub, chips: visuals.chips, cross: visuals.cross },
    arcs,
  };
}

/** The beacon of frame 14 grows and fades once in this long. */
export const BEACON_PERIOD_MS = 1600;

/** Where in its pulse a beacon is: `0` (a ring the size of the pin) to just under `1` (large and gone). */
export function beaconPhase(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  return (elapsedMs % BEACON_PERIOD_MS) / BEACON_PERIOD_MS;
}

import type { PulseFault } from '../state/pulses';
import type { Point3 } from './twinFlow';

/**
 * The pure side of a dot on an arc of the twin: when it starts, how long it takes, where it is. A dot is drawn only when
 * the engine published (the pulse bus tells it); nothing here has a clock or a loop of its own.
 */

/** How long a dot takes to cross an arc: the Topology's `DOT_MS`, a copy because that file is a hook's. */
export const TWIN_DOT_MS = 1400;

/** A delayed dot is never slower than this, so a long delay setting does not leave dots crossing for minutes. */
export const MAX_TRAVEL_MS = 5000;

/** Dots alive on the whole screen (the brief: at most 24). The per-arc cap is `MAX_DOTS_PER_EDGE` of the pulse bus. */
export const SCREEN_DOT_CAP = 24;

/** The second copy of a duplicate follows the first by this long, so the two read as a pair and not as one dot. */
export const DUPLICATE_GAP_MS = 150;

/**
 * Milliseconds a dot takes to cross an arc whose messages the Delay fault holds back by `slowMs`: the base crossing time
 * plus the delay, so a delayed dot is visibly slower and dots bunch up where they arrive.
 */
export function dotTravelMs(slowMs: number): number {
  const extra = Number.isFinite(slowMs) && slowMs > 0 ? slowMs : 0;
  return Math.min(MAX_TRAVEL_MS, TWIN_DOT_MS + extra);
}

/**
 * When, after the pulse, the dot of a message starts. A plain message starts at once. A duplicate is a second `published`
 * event for the same reading (its `fault` says so), and it starts a little late, so the two dots travel as a pair.
 * A burst is not special-cased: its messages meet the arc's cap and the screen's cap and the rest are dropped.
 */
export function startDelayMs(fault: PulseFault | undefined): number {
  return fault === 'duplicate' ? DUPLICATE_GAP_MS : 0;
}

export interface DrawConditions {
  /** The tab is hidden: nothing is drawn (and nothing would be seen). */
  hidden: boolean;
  /** The viewer asked for less motion. */
  reduced: boolean;
  /** The arc is lit: a dim wire or a red one carries no dots. */
  lit: boolean;
}

/** Whether a pulse draws a dot now. */
export function shouldDraw({ hidden, reduced, lit }: DrawConditions): boolean {
  return lit && !hidden && !reduced;
}

const distance = (a: Point3, b: Point3): number =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/**
 * The point at `t` (0 to 1) along the polyline, by length and not by index, so a dot moves at one speed along a curve
 * whose points are not evenly spaced. `t` outside the range is held to the ends; a line of no points has no point.
 */
export function pointAt(points: readonly Point3[], t: number): Point3 | null {
  const first = points[0];
  if (first === undefined) return null;
  const last = points[points.length - 1] ?? first;
  if (!(t > 0)) return first;
  if (t >= 1) return last;

  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += distance(points[i - 1] as Point3, points[i] as Point3);
  }
  if (length === 0) return first;

  let remaining = t * length;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1] as Point3;
    const to = points[i] as Point3;
    const segment = distance(from, to);
    if (remaining <= segment && segment > 0) {
      const k = remaining / segment;
      return [
        from[0] + (to[0] - from[0]) * k,
        from[1] + (to[1] - from[1]) * k,
        from[2] + (to[2] - from[2]) * k,
      ];
    }
    remaining -= segment;
  }
  return last;
}

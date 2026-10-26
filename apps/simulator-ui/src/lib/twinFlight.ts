import type { CameraView } from './twinCamera';

/**
 * The flight of the camera to a preset: 600 ms, eased at both ends, and instant when the viewer asked for less motion.
 * Pure, so the duration and the reduced-motion case are tested; the scene's `CameraRig` asks it for the view at each frame.
 */

export const FLIGHT_MS = 600;

/** Slow at both ends, fast in the middle (a cubic ease in and out). `t` is clamped to 0 – 1. */
export function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

const mix = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  amount: number,
): [number, number, number] => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
];

export interface FlightOptions {
  /** Under `prefers-reduced-motion`: arrive at once. */
  instant?: boolean;
  durationMs?: number;
}

export interface FlightFrame extends CameraView {
  /** True once the view is `to`: the caller stops asking for frames. */
  done: boolean;
}

/** The view `elapsedMs` after a flight from `from` to `to` began. */
export function flightAt(
  from: CameraView,
  to: CameraView,
  elapsedMs: number,
  { instant = false, durationMs = FLIGHT_MS }: FlightOptions = {},
): FlightFrame {
  if (instant || durationMs <= 0 || elapsedMs >= durationMs) {
    return { position: [...to.position], target: [...to.target], done: true };
  }
  const amount = easeInOut(Math.max(0, elapsedMs) / durationMs);
  return {
    position: mix(from.position, to.position, amount),
    target: mix(from.target, to.target, amount),
    done: false,
  };
}

import type { TimeWindow } from './eventRows';

/**
 * The density strip of the event timeline (frame 11): how many events fell in each stretch of the window, and the
 * arithmetic of its two handles. Pure, so the strip can be drawn at any pixel width and tested without a pointer.
 *
 * The strip covers the window of the range. At rest its handles are at the two ends; dragging one inward narrows the
 * range to a custom one when it is released, and the strip then covers that narrower window, so it never holds a
 * selection that the table does not show.
 */

/** The most stretches the strip draws; a longer window gets longer stretches, so the bars stay readable. */
export const MAX_BUCKETS = 120;
/** The shortest range a pair of handles can leave: one minute. */
export const MIN_SPAN_MS = 60_000;
const MINUTE = 60_000;
/** The lengths of a stretch, in minutes: the first that keeps the strip under `MAX_BUCKETS`. */
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120];

export interface Density {
  /** The length of a stretch, in ms. */
  bucketMs: number;
  /** Events in each stretch from the start of the window; the last stretch includes the end. */
  counts: number[];
  /** The most events in one stretch (`0` for an empty window). */
  busiest: number;
}

export function bucketMsFor(spanMs: number): number {
  const minutes = spanMs / MINUTE / MAX_BUCKETS;
  return (STEPS.find((step) => step >= minutes) ?? (STEPS.at(-1) as number)) * MINUTE;
}

/** Counts the events (their times, in ms) by stretch of the window. An event outside the window is not counted. */
export function density(times: readonly number[], window: TimeWindow): Density {
  const span = Math.max(window.to - window.from, 1);
  const bucketMs = bucketMsFor(span);
  const counts = new Array<number>(Math.max(1, Math.ceil(span / bucketMs))).fill(0);
  for (const time of times) {
    if (time < window.from || time > window.to) continue;
    const at = Math.min(Math.floor((time - window.from) / bucketMs), counts.length - 1);
    counts[at] = (counts[at] as number) + 1;
  }
  return { bucketMs, counts, busiest: Math.max(0, ...counts) };
}

/** The unit of a stretch in words: "minute", "5 minutes", "hour", "2 hours". */
export function bucketWord(bucketMs: number): string {
  const minutes = bucketMs / MINUTE;
  if (minutes === 1) return 'minute';
  if (minutes < 60) return `${minutes} minutes`;
  return minutes === 60 ? 'hour' : `${minutes / 60} hours`;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** The time under a pixel of a strip `width` wide, kept inside the window. */
export function timeAtX(x: number, width: number, window: TimeWindow): number {
  if (width <= 0) return window.from;
  return window.from + clamp(x / width, 0, 1) * (window.to - window.from);
}

/** The pixel of a time on a strip `width` wide, kept inside it. */
export function xAtTime(time: number, width: number, window: TimeWindow): number {
  const span = window.to - window.from;
  return span <= 0 ? 0 : clamp((time - window.from) / span, 0, 1) * width;
}

export type Handle = 'from' | 'to';

/**
 * Where the two handles stand after one was moved to `time`: inside the window, and never closer to the other than
 * `minSpan` (the window is shorter than that only when it is already as narrow as it can be, and then nothing moves).
 */
export function moveHandle(
  window: TimeWindow,
  selection: TimeWindow,
  handle: Handle,
  time: number,
  minSpan: number = MIN_SPAN_MS,
): TimeWindow {
  const room = Math.min(minSpan, window.to - window.from);
  if (handle === 'from') {
    return { from: clamp(time, window.from, selection.to - room), to: selection.to };
  }
  return { from: selection.from, to: clamp(time, selection.from + room, window.to) };
}

/** What a key does to the handle that has focus: a step in ms, or the end it goes to. `null` for any other key. */
export function handleKey(key: string, shift: boolean): number | 'start' | 'end' | null {
  const step = shift ? 10 * MINUTE : MINUTE;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return step;
    case 'ArrowLeft':
    case 'ArrowDown':
      return -step;
    case 'Home':
      return 'start';
    case 'End':
      return 'end';
    default:
      return null;
  }
}

/** A handle moved by a key; `start` and `end` go to the ends of the window, which the other handle may stop. */
export function keyMoveHandle(
  window: TimeWindow,
  selection: TimeWindow,
  handle: Handle,
  move: number | 'start' | 'end',
  minSpan: number = MIN_SPAN_MS,
): TimeWindow {
  const current = selection[handle];
  const target = move === 'start' ? window.from : move === 'end' ? window.to : current + move;
  return moveHandle(window, selection, handle, target, minSpan);
}

/** Times at even places along the window for the axis under the strip, and where they fall (0 to 1). */
export function axisTimes(window: TimeWindow, count = 5): { time: number; at: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const at = count === 1 ? 0 : i / (count - 1);
    return { time: window.from + at * (window.to - window.from), at };
  });
}

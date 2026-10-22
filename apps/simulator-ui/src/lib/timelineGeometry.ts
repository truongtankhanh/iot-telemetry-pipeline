import { type ChartAxis, timeAxis } from './scenarioChart';

/**
 * The arithmetic of the timeline editor's picture, kept out of the components: which window of seconds it shows, how a
 * pixel becomes a time, what a key press does to a block. The picture itself is `labTimeline.ts`'s; the edits it asks for
 * are `timelineEditor.ts`'s. Pure functions, no DOM.
 */

/** The frame's Length control: the editing windows, in seconds. They are what the picture shows, not a limit of the document. */
export const WINDOW_OPTIONS = [120, 180, 300] as const;

/** Above this many anomalies the lanes group by zone, as the Lab's dock does (frame 19). */
export const GROUP_ABOVE_ANOMALIES = 12;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A box that only has to exist: `timeAxis` reads the horizon, not the pixels, to choose its ticks. */
const UNIT_BOX = { left: 0, right: 1, top: 0, bottom: 1 };

/**
 * The window that holds a scenario of this length: the smallest of 120, 180 and 300 s that does, else the length rounded
 * up to what the axis can number (a 420 s scenario shows 480 s: 4 ticks of 120).
 */
export function windowFor(lengthS: number): number {
  const need = Math.max(lengthS, 0);
  const option = WINDOW_OPTIONS.find((candidate) => candidate >= need);
  return option ?? timeAxis(Math.ceil(need), 0, UNIT_BOX).maxS;
}

export interface WindowOption {
  value: number;
  label: string;
  /** A window that is too short for the scenario cannot be chosen. */
  disabled: boolean;
}

/** The three windows, those too short for the scenario disabled, and the scenario's own window when it needs more than 300 s. */
export function windowOptions(lengthS: number): WindowOption[] {
  const need = windowFor(lengthS);
  const options = WINDOW_OPTIONS.map((value) => ({
    value,
    label: `${value} s`,
    disabled: value < need,
  }));
  return need > WINDOW_OPTIONS[WINDOW_OPTIONS.length - 1]!
    ? [...options, { value: need, label: `${need} s`, disabled: false }]
    : options;
}

/**
 * The window on show: the one the person chose, unless it no longer holds the scenario (or is a window that is not offered
 * any more), then the smallest that does. Typing a later start into the inspector widens the window by itself.
 */
export function effectiveWindow(chosen: number | null, lengthS: number): number {
  const need = windowFor(lengthS);
  const offered = chosen !== null && (WINDOW_OPTIONS as readonly number[]).includes(chosen);
  return offered && chosen >= need ? chosen : need;
}

type Scale = Pick<ChartAxis, 'left' | 'right' | 'maxS'>;

/** Seconds a pixel is worth. */
export const secondsPerPx = (axis: Scale): number => axis.maxS / (axis.right - axis.left);

/** The time at an x on the picture, kept inside the window and to a tenth. */
export const timeAt = (axis: Scale, x: number): number =>
  clamp(round1((x - axis.left) * secondsPerPx(axis)), 0, axis.maxS);

/** Seconds that `dx` pixels are worth (negative to the left). */
export const deltaS = (axis: Scale, dx: number): number => dx * secondsPerPx(axis);

/**
 * Where a block that was grabbed at `startAt` should start after the pointer moved `dx` pixels: kept inside the window, so the
 * block can be pushed to its edge and no further (the window is widened with the Length control, not by dragging).
 */
export function moveTarget(axis: Scale, startAt: number, dx: number, durationS: number): number {
  return clamp(startAt + deltaS(axis, dx), 0, Math.max(0, axis.maxS - durationS));
}

export interface KeyEdit {
  action: 'move' | 'resize-end' | 'resize-start';
  /** Seconds, signed. */
  delta: number;
}

/**
 * What an arrow key does to the selected block: moves it by the snap step; with Shift it moves the end edge; with Shift
 * and Alt, the start edge. Any other key is not the editor's here.
 */
export function keyEdit(
  key: string,
  modifiers: { shift: boolean; alt: boolean },
  step: number,
): KeyEdit | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const delta = key === 'ArrowRight' ? step : -step;
  if (!modifiers.shift) return { action: 'move', delta };
  return { action: modifiers.alt ? 'resize-start' : 'resize-end', delta };
}

/** True when a scenario of this many anomalies is drawn with a lane for each zone. */
export const groupedAbove = (anomalies: number): boolean => anomalies > GROUP_ABOVE_ANOMALIES;

/** The set of expanded zones after the person opens or closes `zone`; the set it was given is not changed. */
export function toggleZone(expanded: ReadonlySet<string>, zone: string): ReadonlySet<string> {
  const next = new Set(expanded);
  if (next.has(zone)) next.delete(zone);
  else next.add(zone);
  return next;
}

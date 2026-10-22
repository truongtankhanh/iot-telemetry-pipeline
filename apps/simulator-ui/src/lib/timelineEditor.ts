import type { Anomaly, ScenarioItem } from '../api/types';
import { MAX_DURATION_S } from './labFault';
import { seconds } from './scenarioExpectation';

/**
 * The timeline editor's working copy of a scenario (frame 05), kept out of the components: a scenario is a name, a
 * description and a list of anomalies, and every edit is a pure function from one copy to the next. Times are seconds
 * from the start of the scenario, as in the document the simulator keeps. Nothing here talks to the simulator, and no alert
 * time is worked out here (the simulator says what the rules should do).
 *
 * The simulator's limits are respected where they can be (50 anomalies, a duration above 0 and at most 3,600 s, no two
 * anomalies at once on one device and metric); what is only a matter of a field's value (a range, a name) is
 * `timelineValidation.ts`'s, so that a copy can hold a half-typed value and say what is wrong with it.
 */

/** The most anomalies a scenario file holds (the simulator refuses more). */
export const MAX_EDITOR_ANOMALIES = 50;

/** The shortest block a drag or a resize leaves. */
export const MIN_DURATION_S = 1;

/** Snap on moves blocks by 5 s; off, by 1 s (the frame's switch). The inspector's fields take any tenth of a second. */
export const SNAP_ON_S = 5;
export const SNAP_OFF_S = 1;

/** A scenario as the simulator keeps it and as the file reads: the key order is the file's. */
export interface ScenarioDocument {
  name: string;
  description: string;
  anomalies: Anomaly[];
}

export interface EditorEntry {
  /** A key for the lists, the selection and the drawing; unique within the copy and not part of the document. */
  id: string;
  anomaly: Anomaly;
}

export interface EditorDoc {
  name: string;
  description: string;
  entries: readonly EditorEntry[];
  /** The number the next entry's id is made from, so that the functions below stay pure. */
  nextId: number;
}

export const EMPTY_DOC: EditorDoc = { name: '', description: '', entries: [], nextId: 1 };

const round1 = (n: number) => Math.round(n * 10) / 10;

const end = (anomaly: Anomaly) => anomaly.startAt + anomaly.duration;

const sameSignal = (a: Anomaly, b: Anomaly) => a.deviceId === b.deviceId && a.metric === b.metric;

/** A time on the grid of `step` seconds, to a tenth. */
export const snapTo = (t: number, step: number): number => round1(Math.round(t / step) * step);

function withIds(anomalies: readonly Anomaly[]): { entries: EditorEntry[]; nextId: number } {
  return {
    entries: anomalies.map((anomaly, index) => ({ id: `a${index + 1}`, anomaly: { ...anomaly } })),
    nextId: anomalies.length + 1,
  };
}

/** A saved scenario, opened for editing. */
export function fromScenario(
  item: Pick<ScenarioItem, 'name' | 'description' | 'anomalies'>,
): EditorDoc {
  return { name: item.name, description: item.description, ...withIds(item.anomalies) };
}

/** `name` for the copy of a scenario: "-copy" added, cut so that the name stays within the 64 characters the format allows. */
export function copyName(name: string): string {
  const suffix = '-copy';
  return `${name.slice(0, 64 - suffix.length)}${suffix}`;
}

/** A copy of a scenario to edit under a new name (the original is untouched). */
export function copyOf(item: Pick<ScenarioItem, 'name' | 'description' | 'anomalies'>): EditorDoc {
  return { ...fromScenario(item), name: copyName(item.name) };
}

/** A list of anomalies with no name yet (the Lab's timeline handed over). */
export function fromAnomalies(anomalies: readonly Anomaly[]): EditorDoc {
  return { name: '', description: '', ...withIds(anomalies) };
}

/** The document the simulator keeps: the fields in the file's order, a shape only when there is one. */
export function toDocument(doc: EditorDoc): ScenarioDocument {
  return {
    name: doc.name,
    description: doc.description,
    anomalies: doc.entries.map(({ anomaly }) => {
      const { deviceId, metric, value, startAt, duration, shape } = anomaly;
      return {
        deviceId,
        metric,
        value,
        startAt,
        duration,
        ...(shape === undefined ? {} : { shape }),
      };
    }),
  };
}

export const anomaliesOf = (doc: EditorDoc): Anomaly[] => doc.entries.map((entry) => entry.anomaly);

/** Seconds from the start to the end of the last anomaly; 0 for none. */
export function lengthOf(doc: EditorDoc): number {
  return doc.entries.reduce((longest, entry) => Math.max(longest, end(entry.anomaly)), 0);
}

/**
 * Whether the copy differs from what is saved. `base` is the saved document the copy was opened from, or `null` for a
 * copy that is not saved anywhere (a new scenario, a duplicate, a handed-over timeline), which counts as changed as soon as
 * it holds anything.
 */
export function isDirty(doc: EditorDoc, base: ScenarioDocument | null): boolean {
  if (base === null) return doc.name !== '' || doc.description !== '' || doc.entries.length > 0;
  return JSON.stringify(toDocument(doc)) !== JSON.stringify(base);
}

// ---- Collisions ----

/** The reason, in words, that an anomaly cannot play with another on its device and metric; `null` when it can. */
function clashWith(anomaly: Anomaly, others: readonly EditorEntry[]): string | null {
  for (const { anomaly: other } of others) {
    if (
      sameSignal(other, anomaly) &&
      other.startAt < end(anomaly) &&
      anomaly.startAt < end(other)
    ) {
      return `${anomaly.deviceId} already has a fault on ${anomaly.metric} in the scenario from ${seconds(round1(other.startAt))} to ${seconds(round1(end(other)))}`;
    }
  }
  return null;
}

/**
 * The room an entry has on its device and metric: it cannot pass the neighbour on either side (the order of the blocks on
 * a signal does not change by dragging). `left` is the end of the block before it (or 0), `right` the start of the block after
 * it (or `Infinity`).
 */
export function roomOf(doc: EditorDoc, id: string): { left: number; right: number } | null {
  const entry = doc.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return null;
  const { anomaly } = entry;
  let left = 0;
  let right = Infinity;
  for (const other of doc.entries) {
    if (other.id === id || !sameSignal(other.anomaly, anomaly)) continue;
    if (end(other.anomaly) <= anomaly.startAt) left = Math.max(left, end(other.anomaly));
    else if (other.anomaly.startAt >= end(anomaly)) right = Math.min(right, other.anomaly.startAt);
  }
  return { left, right };
}

const replaceEntry = (doc: EditorDoc, id: string, anomaly: Anomaly): EditorDoc => ({
  ...doc,
  entries: doc.entries.map((entry) => (entry.id === id ? { ...entry, anomaly } : entry)),
});

export interface Drag {
  doc: EditorDoc;
  /** What stopped the drag short of where the pointer is, or `null`: said in a status line. */
  notice: string | null;
}

const stopped = (anomaly: Anomaly) =>
  `Stopped at the edge of the next block on ${anomaly.deviceId} ${anomaly.metric}`;

/**
 * Moves a block so that it starts at `startAt` (snapped to `step`), keeping its length. It stops at the edge of a neighbour
 * on its device and metric and at 0 (decision Q6) and then says so.
 */
export function moveEntry(doc: EditorDoc, id: string, startAt: number, step: number): Drag {
  const entry = doc.entries.find((candidate) => candidate.id === id);
  const room = roomOf(doc, id);
  if (entry === undefined || room === null) return { doc, notice: null };
  const { anomaly } = entry;
  const wanted = snapTo(startAt, step);
  const latest = room.right - anomaly.duration;
  const placed = round1(Math.min(Math.max(wanted, room.left), Math.max(room.left, latest)));
  // Only a neighbour is worth saying; the left edge of the picture needs no sentence.
  const byNeighbour =
    (wanted < room.left && room.left > 0) || (wanted > latest && Number.isFinite(latest));
  return {
    doc: replaceEntry(doc, id, { ...anomaly, startAt: placed }),
    notice: byNeighbour ? stopped(anomaly) : null,
  };
}

/**
 * Moves one edge of a block to `time` (snapped to `step`): the start edge changes the start and the duration, the end edge
 * the duration. The block keeps at least `MIN_DURATION_S`, at most the simulator's 3,600 s, and stops at its neighbour.
 */
export function resizeEntry(
  doc: EditorDoc,
  id: string,
  edge: 'start' | 'end',
  time: number,
  step: number,
): Drag {
  const entry = doc.entries.find((candidate) => candidate.id === id);
  const room = roomOf(doc, id);
  if (entry === undefined || room === null) return { doc, notice: null };
  const { anomaly } = entry;
  const wanted = snapTo(time, step);
  let resized: Anomaly;
  let byNeighbour: boolean;
  if (edge === 'end') {
    const lowest = anomaly.startAt + MIN_DURATION_S;
    const highest = Math.min(room.right, anomaly.startAt + MAX_DURATION_S);
    const placed = round1(Math.min(Math.max(wanted, lowest), Math.max(lowest, highest)));
    resized = { ...anomaly, duration: round1(placed - anomaly.startAt) };
    byNeighbour = wanted > highest && highest === room.right;
  } else {
    const finish = end(anomaly);
    const highest = finish - MIN_DURATION_S;
    const lowest = Math.max(room.left, finish - MAX_DURATION_S);
    const placed = round1(Math.min(Math.max(wanted, lowest), highest));
    resized = { ...anomaly, startAt: placed, duration: round1(finish - placed) };
    byNeighbour = wanted < lowest && lowest === room.left && room.left > 0;
  }
  return { doc: replaceEntry(doc, id, resized), notice: byNeighbour ? stopped(anomaly) : null };
}

// ---- Editing ----

export type EditResult = { ok: true; doc: EditorDoc } | { ok: false; reason: string };

export type AddResult = { ok: true; doc: EditorDoc; id: string } | { ok: false; reason: string };

/** Why no anomaly can be added to the copy (it holds the most a scenario may), or `null` when one can. */
export const addEntryDisabledReason = (doc: EditorDoc): string | null =>
  doc.entries.length >= MAX_EDITOR_ANOMALIES
    ? `A scenario holds at most ${MAX_EDITOR_ANOMALIES} anomalies`
    : null;

/** Adds an anomaly, or says why it cannot be: 50 are the most, and it may not play at once with another on its device and metric. */
export function addEntry(doc: EditorDoc, anomaly: Anomaly): AddResult {
  const full = addEntryDisabledReason(doc);
  if (full !== null) return { ok: false, reason: full };
  const clash = clashWith(anomaly, doc.entries);
  if (clash !== null) return { ok: false, reason: clash };
  const id = `a${doc.nextId}`;
  return {
    ok: true,
    id,
    doc: {
      ...doc,
      entries: [...doc.entries, { id, anomaly: { ...anomaly } }],
      nextId: doc.nextId + 1,
    },
  };
}

export type EntryPatch = Partial<
  Pick<Anomaly, 'deviceId' | 'metric' | 'value' | 'startAt' | 'duration'>
> & {
  /** `undefined` is the step, the default, and is written without a shape. */
  shape?: Anomaly['shape'] | undefined;
};

/**
 * Changes fields of an anomaly. A number that is not finite is refused. A change that would make the anomaly play at once
 * with another on its device and metric is refused with the reason, and the copy is left as it was (decision Q6); a value that is
 * only out of range is kept, and `timelineValidation.ts` says so.
 */
export function editEntry(doc: EditorDoc, id: string, patch: EntryPatch): EditResult {
  const entry = doc.entries.find((candidate) => candidate.id === id);
  if (entry === undefined) return { ok: false, reason: 'That anomaly is gone' };
  for (const field of ['value', 'startAt', 'duration'] as const) {
    const given = patch[field];
    if (given !== undefined && !Number.isFinite(given)) {
      return { ok: false, reason: 'Enter a number' };
    }
  }
  const { shape, ...rest } = patch;
  const next: Anomaly = { ...entry.anomaly, ...rest };
  if ('shape' in patch) {
    if (shape === undefined || shape === 'step') delete next.shape;
    else next.shape = shape;
  }
  const clash = clashWith(
    next,
    doc.entries.filter((other) => other.id !== id),
  );
  if (clash !== null) return { ok: false, reason: clash };
  return { ok: true, doc: replaceEntry(doc, id, next) };
}

export function removeEntry(doc: EditorDoc, id: string): EditorDoc {
  return { ...doc, entries: doc.entries.filter((entry) => entry.id !== id) };
}

export const setName = (doc: EditorDoc, name: string): EditorDoc => ({ ...doc, name });

export const setDescription = (doc: EditorDoc, description: string): EditorDoc => ({
  ...doc,
  description,
});

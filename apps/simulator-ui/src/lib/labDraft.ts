import type { Anomaly } from '../api/types';
import { seconds } from './scenarioExpectation';

/**
 * The Lab's timeline draft: the faults added with _Add to timeline_, kept in the page until they are injected together
 * (decision D4: page state; leaving the Lab drops it). Times are seconds from the moment the timeline is injected, the
 * same "from now" the form uses. Saving a draft as a scenario is the editor's (SIM-11): the dock's link to it hands the
 * draft over as a new scenario that is not saved yet (`Lab.tsx`).
 */

export interface DraftEntry {
  /** A key for lists and for removal; unique within the draft. */
  id: string;
  anomaly: Anomaly;
}

export type Draft = readonly DraftEntry[];

export const EMPTY_DRAFT: Draft = [];

const end = (anomaly: Anomaly) => anomaly.startAt + anomaly.duration;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The first anomaly of `incoming` that plays at once with another, on the same device and metric, as a reason in words;
 * `null` when none does. The engine plays the first match and does not add two values, so an overlap has no meaning
 * (the simulator refuses it in a scenario and in a preview).
 */
export function draftOverlap(
  existing: readonly Anomaly[],
  incoming: readonly Anomaly[],
): string | null {
  const all = [...existing, ...incoming];
  for (const [j, later] of all.entries()) {
    if (j < existing.length) continue; // the draft was checked when it was made
    for (const earlier of all.slice(0, j)) {
      const same = earlier.deviceId === later.deviceId && earlier.metric === later.metric;
      if (same && earlier.startAt < end(later) && later.startAt < end(earlier)) {
        return `${later.deviceId} already has a fault on ${later.metric} in the timeline from ${seconds(round1(earlier.startAt))} to ${seconds(round1(end(earlier)))}`;
      }
    }
  }
  return null;
}

export type AddResult = { ok: true; draft: Draft } | { ok: false; reason: string };

/** Adds the faults of the form (one anomaly per device), or says why it cannot be done. `makeId` gives each entry its key. */
export function addToDraft(
  draft: Draft,
  anomalies: readonly Anomaly[],
  makeId: () => string,
): AddResult {
  if (anomalies.length === 0) return { ok: false, reason: 'There is nothing to add' };
  const clash = draftOverlap(
    draft.map((entry) => entry.anomaly),
    anomalies,
  );
  if (clash !== null) return { ok: false, reason: clash };
  return {
    ok: true,
    draft: [...draft, ...anomalies.map((anomaly) => ({ id: makeId(), anomaly: { ...anomaly } }))],
  };
}

export function removeFromDraft(draft: Draft, id: string): Draft {
  return draft.filter((entry) => entry.id !== id);
}

/** The anomalies of the draft, for the preview and for injecting it. */
export const draftAnomalies = (draft: Draft): Anomaly[] => draft.map((entry) => entry.anomaly);

/** Seconds from the start of the timeline to the end of its last anomaly; 0 for an empty draft. */
export function draftLength(draft: Draft): number {
  return draft.reduce((longest, entry) => Math.max(longest, end(entry.anomaly)), 0);
}

/** "1 anomaly · 80 s", "12 anomalies · starts spread over 22 s" (frames 12 and 19). */
export function draftSummary(draft: Draft): string {
  const count = draft.length;
  if (count === 0) return 'Nothing added yet';
  const noun = `${count} ${count === 1 ? 'anomaly' : 'anomalies'}`;
  const starts = draft.map((entry) => entry.anomaly.startAt);
  const spread = Math.max(...starts) - Math.min(...starts);
  return spread > 0
    ? `${noun} · starts spread over ${seconds(round1(spread))}`
    : `${noun} · ${seconds(round1(draftLength(draft)))}`;
}

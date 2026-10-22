import type { ScenarioItem } from '../../api/types';
import { draftKey } from '../../state/editorDrafts';

/**
 * What the address of the timeline editor asks for, and what it opens (decision Q1): `?scenario=<name>` a saved custom
 * scenario to edit, `?duplicate=<name>` a copy of any scenario, nothing a new one. Both are pointers, not state: a name that
 * does not exist, or a built-in where an edit was asked for, opens a new scenario and says why.
 */

export interface TimelineQuery {
  scenario: string | null;
  duplicate: string | null;
}

const present = (value: string | null) => (value === null || value === '' ? null : value);

/** `?scenario=` wins when both are given. */
export function readTimelineQuery(params: URLSearchParams): TimelineQuery {
  const scenario = present(params.get('scenario'));
  return { scenario, duplicate: scenario === null ? present(params.get('duplicate')) : null };
}

/** The address with the editor's parameters set from `query` and every other parameter left as it was. */
export function writeTimelineQuery(params: URLSearchParams, query: TimelineQuery): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('scenario');
  next.delete('duplicate');
  if (query.scenario !== null) next.set('scenario', query.scenario);
  else if (query.duplicate !== null) next.set('duplicate', query.duplicate);
  return next;
}

export type Opening =
  /** The library has not arrived and the address needs it. */
  | { kind: 'loading' }
  | { kind: 'saved'; key: string; item: ScenarioItem }
  | { kind: 'copy'; key: string; item: ScenarioItem }
  | { kind: 'new'; key: string; notice: string | null };

/**
 * What to open. `scenarios` is the library as last read, or `null` before the first read; a new scenario does not need
 * it, so it opens at once.
 */
export function resolveOpening(
  query: TimelineQuery,
  scenarios: readonly ScenarioItem[] | null,
): Opening {
  if (query.scenario === null && query.duplicate === null) {
    return { kind: 'new', key: draftKey.new, notice: null };
  }
  if (scenarios === null) return { kind: 'loading' };

  if (query.scenario !== null) {
    const item = scenarios.find((candidate) => candidate.name === query.scenario);
    if (item === undefined) {
      return {
        kind: 'new',
        key: draftKey.new,
        notice: `There is no scenario named "${query.scenario}", so this is a new one.`,
      };
    }
    if (item.source === 'built-in') {
      return {
        kind: 'new',
        key: draftKey.new,
        notice: `"${item.name}" is a built-in scenario and cannot be changed; duplicate it to start from it.`,
      };
    }
    return { kind: 'saved', key: draftKey.scenario(item.name), item };
  }

  const item = scenarios.find((candidate) => candidate.name === query.duplicate);
  if (item === undefined) {
    return {
      kind: 'new',
      key: draftKey.new,
      notice: `There is no scenario named "${query.duplicate}" to duplicate, so this is a new one.`,
    };
  }
  return { kind: 'copy', key: draftKey.copy(item.name), item };
}

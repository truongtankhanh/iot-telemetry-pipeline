import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { type EventQuery, readEventQuery, writeEventQuery } from '../../lib/eventQuery';
import type { Grouping } from '../../lib/topology';

/** What the address says about the Overview. */
export interface OverviewQuery {
  /** The scenario the controls show (`?scenario=`, which the command palette links to), or `null` for the default. */
  scenario: string | null;
  /** The graph's search (`gq`: the timeline's filter keeps `q`). */
  gq: string;
  /** `null` is automatic: every device up to 12, zones above. */
  group: Grouping | null;
  /** _Problems only_ in the graph. */
  problems: boolean;
  /** The event timeline: page, size, range, filter and source (`page`, `size`, `range`, `from`, `to`, `q`, `source`). */
  events: EventQuery;
}

/** What `update` takes: any of the page's own parameters, and a part of the timeline's. */
export type OverviewPatch = Partial<Omit<OverviewQuery, 'events'>> & {
  events?: Partial<EventQuery>;
};

/** The longest scenario name the simulator accepts. */
const NAME_MAX_LENGTH = 64;

/** Reads the address. A value that is not usable falls back to the default: a shared link always opens. */
export function parseOverviewQuery(params: URLSearchParams): OverviewQuery {
  const group = params.get('group');
  return {
    scenario: (params.get('scenario') ?? '').slice(0, NAME_MAX_LENGTH) || null,
    gq: (params.get('gq') ?? '').slice(0, 100),
    group: group === 'zone' || group === 'all' ? group : null,
    problems: params.get('problems') === '1',
    events: readEventQuery(params),
  };
}

/** Writes one parameter, or takes it out when it has its default (a plain page has a plain address). */
function write(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null || value === '') params.delete(key);
  else params.set(key, value);
}

/**
 * The query of the Overview, read from and written to the address, so that a reload and a shared link keep the place.
 * A change replaces the history entry (the choice of a scenario is not a page to go back to) and leaves every
 * parameter it does not own as it is: the controls, the graph and the timeline write theirs in the same address.
 */
export function useOverviewParams(): [OverviewQuery, (patch: OverviewPatch) => void] {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseOverviewQuery(params), [params]);

  const update = useCallback(
    (patch: OverviewPatch) => {
      setParams(
        (current) => {
          let next = new URLSearchParams(current);
          if ('scenario' in patch) write(next, 'scenario', patch.scenario ?? null);
          if ('gq' in patch) write(next, 'gq', patch.gq ?? null);
          if ('group' in patch) write(next, 'group', patch.group ?? null);
          if ('problems' in patch) write(next, 'problems', patch.problems ? '1' : null);
          if (patch.events) {
            next = writeEventQuery(next, { ...readEventQuery(next), ...patch.events });
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return [query, update];
}

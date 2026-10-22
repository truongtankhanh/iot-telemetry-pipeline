import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { readTimelineQuery, type TimelineQuery, writeTimelineQuery } from './timelineOpening';

/**
 * The editor's address: which scenario it edits (`?scenario=`) or duplicates (`?duplicate=`). A change replaces the history
 * entry (saving a new scenario points the address at it; that is not a page to go back to) and leaves every parameter it does
 * not own as it is. Setting one of the two clears the other.
 */
export function useTimelineParams(): [TimelineQuery, (patch: Partial<TimelineQuery>) => void] {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => readTimelineQuery(params), [params]);

  const update = useCallback(
    (patch: Partial<TimelineQuery>) => {
      setParams(
        (current) => {
          const next = { ...readTimelineQuery(current), ...patch };
          return writeTimelineQuery(current, next);
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return [query, update];
}

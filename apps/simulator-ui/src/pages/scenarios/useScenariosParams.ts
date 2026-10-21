import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  parseScenarioQuery,
  type ScenarioQuery,
  serializeScenarioQuery,
} from '../../lib/scenarioQuery';

/**
 * The query of the Scenarios page, read from and written to the address: search, tab, sort, page, size and the
 * scenario a link points at survive a reload and a shared link. Every change replaces the history entry (a filter is
 * not modal, so Back does not walk through each keystroke).
 *
 * A change goes back to page 1, since the list under it changed, unless it names a page. The pointer to a scenario
 * (`?scenario=`) is a one-time mark, not a filter: any change drops it unless the change sets it.
 */
export function useScenariosParams(): [ScenarioQuery, (patch: Partial<ScenarioQuery>) => void] {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseScenarioQuery(params), [params]);

  const update = useCallback(
    (patch: Partial<ScenarioQuery>) => {
      setParams(
        (current) => {
          const next = { ...parseScenarioQuery(current), ...patch };
          if (patch.page === undefined) next.page = 1;
          if (patch.scenario === undefined) next.scenario = null;
          return serializeScenarioQuery(next);
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return [query, update];
}

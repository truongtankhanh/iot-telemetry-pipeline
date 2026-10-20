import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  parseTopologyQuery,
  serializeTopologyQuery,
  type TopologyQuery,
} from '../../lib/topologyQuery';

/**
 * The query of the topology page, read from and written to the address. The address is the state: the search, the
 * grouping, _Problems only_ and the selected node survive a reload and a shared link. Every change replaces the
 * history entry (D5 of the plan): a selection is not modal, so a click on the graph must not fill the Back button.
 */
export function useTopologyParams(): [TopologyQuery, (patch: Partial<TopologyQuery>) => void] {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseTopologyQuery(params), [params]);

  const update = useCallback(
    (patch: Partial<TopologyQuery>) => {
      setParams((current) => serializeTopologyQuery({ ...parseTopologyQuery(current), ...patch }), {
        replace: true,
      });
    },
    [setParams],
  );

  return [query, update];
}

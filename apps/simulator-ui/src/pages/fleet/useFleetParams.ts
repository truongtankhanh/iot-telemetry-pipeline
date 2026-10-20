import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { type FleetQuery, parseFleetQuery, serializeFleetQuery } from '../../lib/fleetQuery';

export interface UpdateOptions {
  /** Replace the history entry instead of adding one. A filter replaces; opening the inspector adds, so Back closes it. */
  replace?: boolean;
  /** Keep the page number. By default a change goes back to page 1, since the list under it changed. */
  keepPage?: boolean;
}

/**
 * The query of the Fleet page, read from and written to the address. The address is the state: sort, filters,
 * page, size and the open device survive a reload and a shared link, and Back and Forward move through them.
 */
export function useFleetParams(): [
  FleetQuery,
  (patch: Partial<FleetQuery>, options?: UpdateOptions) => void,
] {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseFleetQuery(params), [params]);

  const update = useCallback(
    (patch: Partial<FleetQuery>, options: UpdateOptions = {}) => {
      setParams(
        (current) => {
          const next = { ...parseFleetQuery(current), ...patch };
          if (!options.keepPage && patch.page === undefined) next.page = 1;
          return serializeFleetQuery(next);
        },
        { replace: options.replace ?? true },
      );
    },
    [setParams],
  );

  return [query, update];
}

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { type LabQuery, readLabQuery, writeLabQuery } from '../../lib/labQuery';

/**
 * The Lab's query, read from and written to the address, so that a reload and a shared link keep the place. A change
 * replaces the history entry (choosing a target is not a page to go back to) and leaves every parameter it does not own
 * as it is. Changing the scope starts a new choice, which is why the caller passes `targets` with it.
 */
export function useLabParams(): [LabQuery, (patch: Partial<LabQuery>) => void] {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => readLabQuery(params), [params]);

  const update = useCallback(
    (patch: Partial<LabQuery>) => {
      setParams((current) => writeLabQuery(current, { ...readLabQuery(current), ...patch }), {
        replace: true,
      });
    },
    [setParams],
  );

  return [query, update];
}

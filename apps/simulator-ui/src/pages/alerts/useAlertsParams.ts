import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { type AlertsQuery, parseAlertsQuery, serializeAlertsQuery } from '../../lib/alertsQuery';

/**
 * The query of the Alerts page, read from and written to the address: status, severity, page size and the open
 * alert survive a reload and a shared link. Every change replaces the history entry: choosing an alert or a filter
 * is not modal, so Back does not walk through each click. The cursor is not here (it lives in memory).
 */
export function useAlertsParams(): [AlertsQuery, (patch: Partial<AlertsQuery>) => void] {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseAlertsQuery(params), [params]);

  const update = useCallback(
    (patch: Partial<AlertsQuery>) => {
      setParams((current) => serializeAlertsQuery({ ...parseAlertsQuery(current), ...patch }), {
        replace: true,
      });
    },
    [setParams],
  );

  return [query, update];
}

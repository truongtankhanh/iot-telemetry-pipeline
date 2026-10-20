import { useCallback, useSyncExternalStore } from 'react';
import type { StateView } from '../../api/types';
import { buildFleetRows } from '../../lib/fleetRows';
import type { FleetRow } from '../../lib/fleetQuery';
import { useHistoryStore } from '../../state/historyContext';

/**
 * The rows of the Fleet, built from the state view and the history. The page renders again when any device has
 * news (the history announces at most once a second per key) and when `now` moves on, which is how a device that
 * goes quiet becomes "silent" without any message arriving. Nothing is memoized: building a hundred rows is a few
 * microseconds a second, and a stale row would be worse than a wasted one.
 */
export function useFleetRows(view: StateView | null, now: number): FleetRow[] {
  const history = useHistoryStore();
  const devices = view?.devices;

  const subscribe = useCallback(
    (listener: () => void) => {
      const stops = (devices ?? []).map((device) => history.subscribe(device.id, listener));
      return () => stops.forEach((stop) => stop());
    },
    [history, devices],
  );
  // Only its change matters: it is what makes this hook render again when a device is heard from.
  useSyncExternalStore(subscribe, () =>
    (devices ?? []).map((d) => history.versionOf(d.id)).join(','),
  );

  if (!view) return [];
  return buildFleetRows({
    view,
    now,
    seriesOf: (deviceId, metric) => history.snapshot(deviceId, metric),
    lastSeenOf: (deviceId) => history.deviceSnapshot(deviceId).lastSeen,
  });
}

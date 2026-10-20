import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { type DeviceSnapshot, type HistoryStore, type Sample, seriesKey } from './history';

/** The history of this window. Provided once by `StudioProvider`; a test provides its own. */
export const HistoryContext = createContext<HistoryStore | null>(null);

export function useHistoryStore(): HistoryStore {
  const history = useContext(HistoryContext);
  if (history === null) throw new Error('The history needs a StudioProvider above it');
  return history;
}

/**
 * The last two minutes of one metric of one device, oldest first. The component renders again when that series
 * has news (at most once a second), and not when another device's does. Do not change the array.
 */
export function useSeries(deviceId: string, metric: string): readonly Sample[] {
  const history = useHistoryStore();
  const key = seriesKey(deviceId, metric);
  const subscribe = useCallback(
    (listener: () => void) => history.subscribe(key, listener),
    [history, key],
  );
  return useSyncExternalStore(subscribe, () => history.snapshot(deviceId, metric));
}

/** When the device was last heard from and what it last said; renders again at most once a second per device. */
export function useDeviceLatest(deviceId: string): DeviceSnapshot {
  const history = useHistoryStore();
  const subscribe = useCallback(
    (listener: () => void) => history.subscribe(deviceId, listener),
    [history, deviceId],
  );
  return useSyncExternalStore(subscribe, () => history.deviceSnapshot(deviceId));
}

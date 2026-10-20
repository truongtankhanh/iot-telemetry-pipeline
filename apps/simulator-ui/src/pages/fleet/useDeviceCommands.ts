import { useCallback, useState } from 'react';
import {
  holdValue,
  pauseDevice,
  releaseValue,
  setDeviceInterval,
  startDevice,
  stopDevice,
} from '../../api/client';
import type { StateView } from '../../api/types';
import { useStudioStore } from '../../state/studioContext';

/** The record without one key. */
const without = (record: Readonly<Record<string, string>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export type DeviceAction = 'start' | 'pause' | 'stop' | 'interval' | 'hold' | 'release';

/**
 * The commands a person can give one device, with what a control needs to show about them: which device is busy
 * and what the simulator said when it refused. The answer to a command is the new state; it goes into the store at
 * once, so the card changes before the stream's own `state` event brings the same news a moment later.
 */
export function useDeviceCommands() {
  const store = useStudioStore();
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  /** Runs one command for a device; resolves true when the simulator accepted it. */
  const run = useCallback(
    async (
      deviceId: string,
      action: DeviceAction,
      send: () => Promise<StateView>,
    ): Promise<boolean> => {
      const key = `${deviceId}:${action}`;
      setBusy((was) => new Set(was).add(key));
      try {
        const view = await send();
        store.getState().setView(view, Date.now());
        setErrors((was) => (deviceId in was ? without(was, deviceId) : was));
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrors((was) => ({ ...was, [deviceId]: message }));
        return false;
      } finally {
        setBusy((was) => {
          const next = new Set(was);
          next.delete(key);
          return next;
        });
      }
    },
    [store],
  );

  return {
    /** True while any command of the device is on its way, or only `action` when given. */
    isBusy: (deviceId: string, action?: DeviceAction) =>
      action === undefined
        ? [...busy].some((key) => key.startsWith(`${deviceId}:`))
        : busy.has(`${deviceId}:${action}`),
    /** What the simulator said about the device's last refused command, or `null`. */
    errorOf: (deviceId: string): string | null => errors[deviceId] ?? null,
    start: (id: string) => run(id, 'start', () => startDevice(id)),
    pause: (id: string) => run(id, 'pause', () => pauseDevice(id)),
    stop: (id: string) => run(id, 'stop', () => stopDevice(id)),
    setInterval: (id: string, ms: number | null) =>
      run(id, 'interval', () => setDeviceInterval(id, ms)),
    hold: (id: string, metric: string, value: number) =>
      run(id, 'hold', () => holdValue(id, metric, value)),
    release: (id: string, metric: string) => run(id, 'release', () => releaseValue(id, metric)),
    clearError: (deviceId: string) => setErrors((was) => without(was, deviceId)),
  };
}

export type DeviceCommands = ReturnType<typeof useDeviceCommands>;

import type { MetricName } from '@itp/telemetry-contract';
import type { StateView } from '../api/types';
import type { Sample } from '../state/history';
import { deviceCode } from './deviceIdentity';
import { deviceStatus } from './deviceStatus';
import type { FleetRow } from './fleetQuery';

export interface FleetRowsInput {
  view: StateView;
  now: number;
  /** The history of one metric of one device (see `HistoryStore.snapshot`). */
  seriesOf: (deviceId: string, metric: string) => readonly Sample[];
  /** When the device was last heard from, or `null`. */
  lastSeenOf: (deviceId: string) => number | null;
}

/** Puts together what the Fleet shows of each device: its registry entry, its state and its newest readings. */
export function buildFleetRows({ view, now, seriesOf, lastSeenOf }: FleetRowsInput): FleetRow[] {
  const engineById = new Map(view.engine.devices.map((d) => [d.id, d]));
  return view.devices.map((device) => {
    const readings = device.metrics.map((metric) => ({
      metric,
      value: seriesOf(device.id, metric).at(-1)?.v ?? null,
    }));
    const latest: Partial<Record<MetricName, number>> = {};
    for (const { metric, value } of readings) if (value !== null) latest[metric] = value;
    const lastSeen = lastSeenOf(device.id);
    return {
      device,
      name: device.name ?? device.id,
      code: deviceCode(device, view.devices),
      status: deviceStatus({
        device,
        engineDevice: engineById.get(device.id),
        engine: view.engine,
        rules: view.rules,
        latest,
        lastSeen,
        now,
      }),
      readings,
      lastSeen,
    };
  });
}

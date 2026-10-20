import type { DeviceInfo } from '../api/types';

export interface HoldTargets {
  /** Devices that report the metric: the ones a hold would reach. */
  targets: string[];
  /** Devices that do not report it: left out, and listed beforehand. */
  skipped: string[];
}

/** The metrics any of the devices report, the one most devices report first, ties in the order first met. */
export function holdMetrics(devices: readonly DeviceInfo[]): string[] {
  const counts = new Map<string, number>();
  for (const device of devices) {
    for (const metric of device.metrics) counts.set(metric, (counts.get(metric) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([metric]) => metric);
}

/** Which of the devices a hold on `metric` reaches, and which it skips. */
export function holdTargets(devices: readonly DeviceInfo[], metric: string): HoldTargets {
  const targets: string[] = [];
  const skipped: string[] = [];
  for (const device of devices) {
    (device.metrics.some((m) => m === metric) ? targets : skipped).push(device.id);
  }
  return { targets, skipped };
}

/** "dc-env-01, dc-env-02 and 3 more": a list for a sentence, cut after `limit` names. */
export function nameList(ids: readonly string[], limit = 5): string {
  if (ids.length <= limit) return ids.join(', ');
  return `${ids.slice(0, limit).join(', ')} and ${ids.length - limit} more`;
}

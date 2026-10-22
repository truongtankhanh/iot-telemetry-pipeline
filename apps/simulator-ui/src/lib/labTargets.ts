import type { DeviceInfo } from '../api/types';
import { type FleetRow, kindLabel, matchesSearch } from './fleetQuery';
import { holdTargets } from './holdTargets';
import { deviceTopologyState } from './topologyState';

/** What a fault is aimed at: single devices, every device of some zones, or every device of some classes (kinds). */
export type TargetScope = 'device' | 'zone' | 'class';

export const TARGET_SCOPES: readonly TargetScope[] = ['device', 'zone', 'class'];

export const SCOPE_LABELS: Record<TargetScope, string> = {
  device: 'Device',
  zone: 'Zone',
  class: 'Class',
};

/** The tabs of the target picker. */
export type TargetTab = 'all' | 'playing' | 'problems';

export const TARGET_TABS: readonly TargetTab[] = ['all', 'playing', 'problems'];

export const TAB_LABELS: Record<TargetTab, string> = {
  all: 'All',
  playing: 'Playing',
  problems: 'Problems',
};

/** A zone in the picker shows this many devices, then "Show n more in this zone" (frame 12). */
export const PICKER_ZONE_LIMIT = 6;

/** The id a target has in a scope: the device id, the zone code or the kind. */
function keyOf(device: DeviceInfo, scope: TargetScope): string {
  return scope === 'device' ? device.id : scope === 'zone' ? device.zoneCode : device.kind;
}

/**
 * The devices a choice reaches, in the registry's order, each once. A zone or a class reaches every device that has it,
 * whether or not the simulator plays the device now.
 */
export function resolveTargets(
  devices: readonly DeviceInfo[],
  scope: TargetScope,
  targets: readonly string[],
): DeviceInfo[] {
  const wanted = new Set(targets);
  return devices.filter((device) => wanted.has(keyOf(device, scope)));
}

/** The choice without what the registry does not have (a shared link can name a device that is gone), in order. */
export function pruneTargets(
  devices: readonly DeviceInfo[],
  scope: TargetScope,
  targets: readonly string[],
): string[] {
  const known = new Set(devices.map((device) => keyOf(device, scope)));
  return [...new Set(targets)].filter((target) => known.has(target));
}

/** Adds or takes out one target, keeping the order in which they were chosen. */
export function toggleTarget(targets: readonly string[], id: string, on: boolean): string[] {
  const without = targets.filter((target) => target !== id);
  return on ? [...without, id] : without;
}

/** The state of a zone's box: none, some or all of its devices chosen. */
export function zoneSelection(
  zoneDeviceIds: readonly string[],
  chosen: ReadonlySet<string>,
): 'none' | 'some' | 'all' {
  const count = zoneDeviceIds.filter((id) => chosen.has(id)).length;
  if (count === 0) return 'none';
  return count === zoneDeviceIds.length ? 'all' : 'some';
}

/** Chooses, or clears, every device of a zone (device scope). */
export function selectZone(
  targets: readonly string[],
  zoneDeviceIds: readonly string[],
  on: boolean,
): string[] {
  const zone = new Set(zoneDeviceIds);
  const rest = targets.filter((target) => !zone.has(target));
  return on ? [...rest, ...zoneDeviceIds] : rest;
}

export interface TargetChip {
  id: string;
  /** What the chip says: the device id, the zone code, the class written for a person. */
  label: string;
  /** The devices the chip stands for in a zone or a class ("Library · 3"); `null` for one device. */
  count: number | null;
}

/** The chips of a choice, in the order chosen. */
export function targetChips(
  devices: readonly DeviceInfo[],
  scope: TargetScope,
  targets: readonly string[],
): TargetChip[] {
  return targets.map((id) => {
    if (scope === 'device') return { id, label: id, count: null };
    const count = devices.filter((device) => keyOf(device, scope) === id).length;
    return { id, label: scope === 'class' ? kindLabel(id) : id, count };
  });
}

export interface TargetCounts {
  /** Devices the fault reaches. */
  devices: number;
  /** Devices the registry has. */
  of: number;
  /** Zones those devices are in. */
  zones: number;
}

export function targetCounts(
  devices: readonly DeviceInfo[],
  reached: readonly DeviceInfo[],
): TargetCounts {
  return {
    devices: reached.length,
    of: devices.length,
    zones: new Set(reached.map((device) => device.zoneCode)).size,
  };
}

/** "Applies to 12 of 100 devices in 3 zones" (frame 19); "1 of 2 devices in BLD-DC" for one zone (frame 12). */
export function appliesSentence(counts: TargetCounts, onlyZone: string | null = null): string {
  const noun = counts.of === 1 ? 'device' : 'devices';
  const where =
    counts.zones === 1
      ? ` in ${onlyZone ?? 'one zone'}`
      : counts.zones > 1
        ? ` in ${counts.zones} zones`
        : '';
  return `Applies to ${counts.devices} of ${counts.of} ${noun}${where}`;
}

/** The devices a metric does not reach among those chosen, and the ones it does. */
export function reachByMetric(reached: readonly DeviceInfo[], metric: string) {
  return holdTargets(reached, metric);
}

/** True when the simulator plays the device now (running, with or without an anomaly or a silence). */
const isPlaying = (row: FleetRow) =>
  row.status.kind === 'running' || row.status.kind === 'anomaly' || row.status.kind === 'silent';

/** Every state but a healthy running device is a problem, as on the Topology page (`isProblem` there). */
const hasProblem = (row: FleetRow) => deviceTopologyState(row.status.kind) !== 'healthy';

export function matchesTab(row: FleetRow, tab: TargetTab): boolean {
  if (tab === 'playing') return isPlaying(row);
  if (tab === 'problems') return hasProblem(row);
  return true;
}

/** The counts on the tabs, over the rows that pass the search (so they follow what is typed). */
export function tabCounts(rows: readonly FleetRow[], q: string): Record<TargetTab, number> {
  const found = rows.filter((row) => matchesSearch(row, q));
  return {
    all: found.length,
    playing: found.filter(isPlaying).length,
    problems: found.filter(hasProblem).length,
  };
}

export interface PickerGroup {
  zone: string;
  /** Every device of the zone that passes the tab and the search. */
  rows: FleetRow[];
  /** Those drawn: all of them when the zone is open, else the first `PICKER_ZONE_LIMIT`. */
  shown: FleetRow[];
  /** "Show n more in this zone". */
  more: number;
}

/**
 * The picker's list for device scope: the rows that pass the tab and the search, under their zone in the order the
 * zones first appear, each cut to a few until its "Show n more" is pressed. A zone with nothing left is left out.
 */
export function pickerGroups(
  rows: readonly FleetRow[],
  options: { tab: TargetTab; q: string; open: ReadonlySet<string>; limit?: number },
): PickerGroup[] {
  const { tab, q, open, limit = PICKER_ZONE_LIMIT } = options;
  const groups = new Map<string, FleetRow[]>();
  for (const row of rows) {
    if (!matchesTab(row, tab) || !matchesSearch(row, q)) continue;
    const list = groups.get(row.device.zoneCode);
    if (list) list.push(row);
    else groups.set(row.device.zoneCode, [row]);
  }
  return [...groups].map(([zone, zoneRows]) => {
    const shown = open.has(zone) ? zoneRows : zoneRows.slice(0, limit);
    return { zone, rows: zoneRows, shown, more: zoneRows.length - shown.length };
  });
}

export interface ScopeOption {
  id: string;
  label: string;
  /** Devices in it. */
  count: number;
}

/** What zone scope and class scope offer: every zone, or every class, with its device count; searched by its name. */
export function scopeOptions(
  devices: readonly DeviceInfo[],
  scope: Exclude<TargetScope, 'device'>,
  q: string,
): ScopeOption[] {
  const counts = new Map<string, number>();
  for (const device of devices) {
    const key = keyOf(device, scope);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return [...counts]
    .map(([id, count]) => ({ id, label: scope === 'class' ? kindLabel(id) : id, count }))
    .filter((option) => {
      const text = `${option.id} ${option.label}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
}

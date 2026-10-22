import type { EngineSnapshot, ObservedAlert } from '../api/types';
import { type FleetRow, matchesSearch } from './fleetQuery';
import { STATUS_ORDER } from './deviceStatus';
import { deviceTopologyState, type TopologyState, worstOf } from './topologyState';

/**
 * The Lab above 60 devices (frame 19): a scrolling list of zones, worst first, each with a stacked bar of the states of
 * its devices and how many of them the fault targets, and, under it, the table of the zone that was chosen. Pure
 * functions of the fleet's rows: the zones are shown by code and device count, as the Topology does (the registry has no
 * zone names).
 */

/** The order the bar draws its states in, and the order of the severity in a count. */
export const BAR_STATES: readonly TopologyState[] = ['healthy', 'anomaly', 'stale', 'down'];

export interface ZoneRow {
  zone: string;
  count: number;
  worst: TopologyState;
  counts: Record<TopologyState, number>;
  /** Devices that are not healthy: anomaly, paused, stopped, silent. */
  problems: number;
  /** Devices of the zone the fault is aimed at. */
  targeted: number;
}

const SEVERITY: Record<TopologyState, number> = { healthy: 0, stale: 1, anomaly: 2, down: 3 };

const compareText = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** One row per zone, worst first (then the zone with more problems, then by code), so a problem is never below the fold. */
export function zoneRows(rows: readonly FleetRow[], targets: ReadonlySet<string>): ZoneRow[] {
  const byZone = new Map<string, FleetRow[]>();
  for (const row of rows) {
    const list = byZone.get(row.device.zoneCode);
    if (list) list.push(row);
    else byZone.set(row.device.zoneCode, [row]);
  }
  const zones = [...byZone].map(([zone, list]): ZoneRow => {
    const counts: Record<TopologyState, number> = { healthy: 0, anomaly: 0, down: 0, stale: 0 };
    for (const row of list) counts[deviceTopologyState(row.status.kind)] += 1;
    const worst = worstOf(list.map((row) => deviceTopologyState(row.status.kind))) ?? 'healthy';
    return {
      zone,
      count: list.length,
      worst,
      counts,
      problems: list.length - counts.healthy,
      targeted: list.filter((row) => targets.has(row.device.id)).length,
    };
  });
  return zones.sort(
    (a, b) =>
      SEVERITY[b.worst] - SEVERITY[a.worst] ||
      b.problems - a.problems ||
      compareText(a.zone, b.zone),
  );
}

/** The zones that pass the search (by code) and, when asked, only those with a problem. */
export function filterZones(
  zones: readonly ZoneRow[],
  options: { q: string; problemsOnly: boolean },
): ZoneRow[] {
  const words = options.q.toLowerCase().split(/\s+/).filter(Boolean);
  return zones.filter(
    (zone) =>
      (!options.problemsOnly || zone.problems > 0) &&
      words.every((word) => zone.zone.toLowerCase().includes(word)),
  );
}

export interface BarSegment {
  state: TopologyState;
  count: number;
  /** Its share of the zone's devices, 0 to 1; the shares of a bar add up to 1. */
  share: number;
}

/** The stacked bar of a zone: the states that are present, in the fixed order, with their shares. */
export function stateBar(counts: Record<TopologyState, number>): BarSegment[] {
  const total = BAR_STATES.reduce((sum, state) => sum + counts[state], 0);
  if (total === 0) return [];
  return BAR_STATES.filter((state) => counts[state] > 0).map((state) => ({
    state,
    count: counts[state],
    share: counts[state] / total,
  }));
}

/** The words under a zone's code: "14 devices", "14 devices · 6 targeted". */
export function zoneLine(zone: ZoneRow): string {
  const devices = `${zone.count} ${zone.count === 1 ? 'device' : 'devices'}`;
  return zone.targeted > 0 ? `${devices} · ${zone.targeted} targeted` : devices;
}

export type ZoneTab = 'all' | 'targets' | 'problems';

export const ZONE_TABS: readonly ZoneTab[] = ['all', 'targets', 'problems'];

export const ZONE_TAB_LABELS: Record<ZoneTab, string> = {
  all: 'All',
  targets: 'Targets',
  problems: 'Problems',
};

export interface ZoneTableRow {
  row: FleetRow;
  targeted: boolean;
  /** "Breach · step" for the fault the engine plays or will play on the device; `null` for none. */
  fault: string | null;
  /** "in 12 s", "34 s ago" for that fault; `null` for none. */
  started: string | null;
  /** The newest alert open on the device, or `null`. */
  alert: ObservedAlert | null;
}

const seconds = (n: number) => `${Math.round(n)} s`;

/** When an anomaly starts, from where the anomaly clock is now. */
export function startedText(startAt: number, elapsedS: number): string {
  const from = startAt - elapsedS;
  return from > 0 ? `in ${seconds(from)}` : `${seconds(-from)} ago`;
}

/** The label of an anomaly in the table: the engine's anomalies are all breaches of a value, with a shape. */
const faultLabel = (shape: string | undefined) => `Breach · ${shape ?? 'step'}`;

export interface ZoneTableInput {
  rows: readonly FleetRow[];
  zone: string;
  tab: ZoneTab;
  targets: ReadonlySet<string>;
  engine: Pick<EngineSnapshot, 'anomalies' | 'elapsedS'>;
  alerts: readonly ObservedAlert[];
  q?: string;
}

export interface ZoneTable {
  rows: ZoneTableRow[];
  counts: Record<ZoneTab, number>;
}

/**
 * The devices of one zone for the table under the list: problems first (the Fleet's order), each with its fault,
 * when it starts, and its open alert. The counts of the tabs follow the search.
 */
export function zoneTable({
  rows,
  zone,
  tab,
  targets,
  engine,
  alerts,
  q = '',
}: ZoneTableInput): ZoneTable {
  const inZone = rows.filter((row) => row.device.zoneCode === zone && matchesSearch(row, q));
  const isTarget = (row: FleetRow) => targets.has(row.device.id);
  const isProblem = (row: FleetRow) => deviceTopologyState(row.status.kind) !== 'healthy';
  const counts: Record<ZoneTab, number> = {
    all: inZone.length,
    targets: inZone.filter(isTarget).length,
    problems: inZone.filter(isProblem).length,
  };
  const shown =
    tab === 'targets'
      ? inZone.filter(isTarget)
      : tab === 'problems'
        ? inZone.filter(isProblem)
        : inZone;
  const ordered = [...shown].sort(
    (a, b) =>
      STATUS_ORDER.indexOf(a.status.kind) - STATUS_ORDER.indexOf(b.status.kind) ||
      compareText(a.device.id, b.device.id),
  );
  return {
    counts,
    rows: ordered.map((row) => {
      const found = engine.anomalies
        .filter(({ anomaly }) => anomaly.deviceId === row.device.id)
        .sort((a, b) => a.anomaly.startAt - b.anomaly.startAt)
        .find(({ anomaly }) => anomaly.startAt + anomaly.duration > engine.elapsedS);
      const alert =
        alerts
          .filter((a) => a.deviceId === row.device.id && a.status === 'open')
          .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))[0] ?? null;
      return {
        row,
        targeted: isTarget(row),
        fault: found ? faultLabel(found.anomaly.shape) : null,
        started: found ? startedText(found.anomaly.startAt, engine.elapsedS) : null,
        alert,
      };
    }),
  };
}

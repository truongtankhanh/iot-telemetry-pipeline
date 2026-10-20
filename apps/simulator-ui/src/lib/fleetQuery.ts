import type { DeviceInfo } from '../api/types';
import { type DeviceStatus, type DeviceStatusKind, STATUS_ORDER } from './deviceStatus';
import { clampPage, PAGE_SIZES, pageCount, rowRange } from './paging';

/**
 * What the Fleet page does with its list of devices, as pure functions: parse and write the address, filter, sort,
 * count the tabs, page, select. The page builds the rows (a device, its state, its newest readings) and draws what
 * these return. Nothing here knows about React, the history or the network, which is also what lets the same code
 * page on the server later: the query is the same, only the list comes from elsewhere.
 */

export type FleetView = 'cards' | 'table';
export type FleetTab = 'all' | DeviceStatusKind;
export type FleetSortKey = 'problems' | 'device' | 'name' | 'class' | 'zone' | 'state' | 'seen';
export type SortDirection = 'asc' | 'desc';

/** Cards are for up to this many devices, 12 to a page; above it the list is a table. */
export const CARD_LIMIT = 12;
export const CARDS_PER_PAGE = 12;
export const TABLE_SIZES = PAGE_SIZES;
export const DEFAULT_TABLE_SIZE = 10;

export const FLEET_TABS: FleetTab[] = ['all', 'running', 'anomaly', 'paused', 'stopped', 'silent'];
export const SORT_KEYS: FleetSortKey[] = [
  'problems',
  'device',
  'name',
  'class',
  'zone',
  'state',
  'seen',
];

export const SORT_LABELS: Record<FleetSortKey, string> = {
  problems: 'Problems first',
  device: 'Device id',
  name: 'Name',
  class: 'Class',
  zone: 'Zone',
  state: 'State',
  seen: 'Last seen',
};

/** The kind of a device written for a person: `server_room` is "Server room". */
export function kindLabel(kind: string): string {
  const words = kind.replace(/[_-]+/g, ' ').trim();
  return words === '' ? kind : words.charAt(0).toUpperCase() + words.slice(1);
}

export interface FleetQuery {
  /** Search text: matches the id, the name, the zone and the kind. */
  q: string;
  zone: string | null;
  kind: string | null;
  tab: FleetTab;
  sort: FleetSortKey;
  dir: SortDirection;
  /** Cards grouped under their zone. */
  group: boolean;
  /** `null` is automatic: cards up to 12 devices, a table above. */
  view: FleetView | null;
  page: number;
  /** Rows per page in the table; cards always take 12. */
  size: number;
  /** The device whose inspector is open. */
  device: string | null;
}

export const DEFAULT_QUERY: FleetQuery = {
  q: '',
  zone: null,
  kind: null,
  tab: 'all',
  sort: 'problems',
  dir: 'asc',
  group: false,
  view: null,
  page: 1,
  size: DEFAULT_TABLE_SIZE,
  device: null,
};

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.includes(value as T) ? (value as T) : null;

/**
 * Reads the address. A value that is not one of the allowed ones falls back to the default instead of failing:
 * a link that was shared with an old or hand-edited address still opens the page.
 */
export function parseFleetQuery(params: URLSearchParams): FleetQuery {
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const dir = oneOf(params.get('dir'), ['asc', 'desc'] as const);
  return {
    q: (params.get('q') ?? '').slice(0, 100),
    zone: params.get('zone') || null,
    kind: params.get('kind') || null,
    tab: oneOf(params.get('tab'), FLEET_TABS) ?? DEFAULT_QUERY.tab,
    sort: oneOf(params.get('sort'), SORT_KEYS) ?? DEFAULT_QUERY.sort,
    dir: dir ?? DEFAULT_QUERY.dir,
    group: params.get('group') === '1',
    view: oneOf(params.get('view'), ['cards', 'table'] as const),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    size: (TABLE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_TABLE_SIZE,
    device: params.get('device') || null,
  };
}

/** Writes the address with only what differs from the default, so the plain page has a plain address. */
export function serializeFleetQuery(query: FleetQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q !== '') params.set('q', query.q);
  if (query.zone) params.set('zone', query.zone);
  if (query.kind) params.set('kind', query.kind);
  if (query.tab !== DEFAULT_QUERY.tab) params.set('tab', query.tab);
  if (query.sort !== DEFAULT_QUERY.sort) params.set('sort', query.sort);
  if (query.sort !== 'problems' && query.dir !== DEFAULT_QUERY.dir) params.set('dir', query.dir);
  if (query.group) params.set('group', '1');
  if (query.view) params.set('view', query.view);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.size !== DEFAULT_TABLE_SIZE) params.set('size', String(query.size));
  if (query.device) params.set('device', query.device);
  return params;
}

/**
 * The view that is shown. Automatic is cards up to 12 devices and a table above. A table can always be asked for
 * (it is how the table is seen with six devices); cards cannot be asked for above 12.
 */
export function effectiveView(query: FleetQuery, deviceCount: number): FleetView {
  if (query.view === 'table') return 'table';
  if (deviceCount > CARD_LIMIT) return 'table';
  return 'cards';
}

/** Whether the Cards choice is offered. */
export const cardsAllowed = (deviceCount: number): boolean => deviceCount <= CARD_LIMIT;

/** A device with what the page shows of it. */
export interface FleetRow {
  device: DeviceInfo;
  /** The name to show: the registry's, else the id. */
  name: string;
  /** The short code (`DC·1`). */
  code: string;
  status: DeviceStatus;
  /** The newest value of each metric, `null` when none is known. */
  readings: { metric: string; value: number | null }[];
  /** When the device was last heard from (ms), or `null`. */
  lastSeen: number | null;
}

const haystack = (row: FleetRow) =>
  [
    row.device.id,
    row.name,
    row.device.zoneCode,
    row.device.kind.replace(/_/g, ' '),
    row.device.kind,
  ]
    .join(' ')
    .toLowerCase();

/** True when every word of the search is in the id, name, zone or kind. */
export function matchesSearch(row: FleetRow, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = haystack(row);
  return words.every((word) => text.includes(word));
}

const rankOf = (kind: DeviceStatusKind) => STATUS_ORDER.indexOf(kind);

const compareNumber = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

const compareText = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

function compareBy(sort: FleetSortKey): (a: FleetRow, b: FleetRow) => number {
  switch (sort) {
    case 'device':
      return (a, b) => compareText(a.device.id, b.device.id);
    case 'name':
      return (a, b) => compareText(a.name, b.name);
    case 'class':
      return (a, b) => compareText(a.device.kind, b.device.kind);
    case 'zone':
      return (a, b) => compareText(a.device.zoneCode, b.device.zoneCode);
    case 'state':
    case 'problems':
      return (a, b) => rankOf(a.status.kind) - rankOf(b.status.kind);
    case 'seen':
      // Ascending is the longest quiet first, and a device never heard from is the quietest.
      return (a, b) => compareNumber(a.lastSeen ?? -Infinity, b.lastSeen ?? -Infinity);
  }
}

export interface FleetResult {
  /** Every row that passes the search, zone, kind and tab filters, sorted. */
  rows: FleetRow[];
  /** The tab counts over the rows that pass the search, zone and kind filters (so they follow what is typed). */
  counts: Record<FleetTab, number>;
}

/** Filters, counts the tabs and sorts. The sort is stable and ends on the id, so the order never shuffles. */
export function applyFleetQuery(all: readonly FleetRow[], query: FleetQuery): FleetResult {
  const scoped = all.filter(
    (row) =>
      matchesSearch(row, query.q) &&
      (query.zone === null || row.device.zoneCode === query.zone) &&
      (query.kind === null || row.device.kind === query.kind),
  );
  const counts = { all: scoped.length, running: 0, anomaly: 0, paused: 0, stopped: 0, silent: 0 };
  for (const row of scoped) counts[row.status.kind] += 1;

  const filtered =
    query.tab === 'all' ? [...scoped] : scoped.filter((r) => r.status.kind === query.tab);
  const compare = compareBy(query.sort);
  const sign = query.sort === 'problems' || query.dir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => sign * compare(a, b) || compareText(a.device.id, b.device.id));
  return { rows: filtered, counts };
}

/** The zones and kinds to offer in the filters, from all devices, sorted. */
export function facets(devices: readonly DeviceInfo[]): { zones: string[]; kinds: string[] } {
  return {
    zones: [...new Set(devices.map((d) => d.zoneCode))].sort(compareText),
    kinds: [...new Set(devices.map((d) => d.kind))].sort(compareText),
  };
}

export interface FleetPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  size: number;
  total: number;
  /** 1-based and inclusive; 0 and 0 when empty. */
  from: number;
  to: number;
}

/** One page of a list; a page number past the end is the last page. */
export function paginate<T>(items: readonly T[], page: number, size: number): FleetPage<T> {
  const count = pageCount(items.length, size);
  const current = clampPage(page, count);
  const { from, to } = rowRange(current, size, items.length);
  return {
    items: items.slice((current - 1) * size, current * size),
    page: current,
    pageCount: count,
    size,
    total: items.length,
    from,
    to,
  };
}

/** Rows grouped under their zone, in the order the zones first appear (so a sort still shows). */
export function groupByZone(rows: readonly FleetRow[]): { zone: string; rows: FleetRow[] }[] {
  const groups = new Map<string, FleetRow[]>();
  for (const row of rows) {
    const list = groups.get(row.device.zoneCode);
    if (list) list.push(row);
    else groups.set(row.device.zoneCode, [row]);
  }
  return [...groups].map(([zone, list]) => ({ zone, rows: list }));
}

/** The state of a header checkbox for the rows on a page: none, some or all selected. */
export function pageSelection(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
): 'none' | 'some' | 'all' {
  const count = pageIds.filter((id) => selected.has(id)).length;
  if (count === 0) return 'none';
  return count === pageIds.length ? 'all' : 'some';
}

export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Selects, or unselects, every id of a page, leaving the rest of the selection as it is. */
export function setPageSelected(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
  on: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const id of pageIds) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/**
 * Keeps only the ids that still exist in the list (a device that left the filter or the registry cannot stay
 * selected, or a bulk command would act on something nobody can see).
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  const visible = new Set(visibleIds);
  return new Set([...selected].filter((id) => visible.has(id)));
}

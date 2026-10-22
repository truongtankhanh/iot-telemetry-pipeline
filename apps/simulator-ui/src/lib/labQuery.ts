import type { DeviceInfo } from '../api/types';
import { LOG_FILTERS, type LogFilter } from './labLog';
import { pruneTargets, TARGET_SCOPES, type TargetScope } from './labTargets';
import { ZONE_TABS, type ZoneTab } from './labZones';

/**
 * The address of the Lab, as pure functions: which targets are chosen and in which scope, the zone selected in the list,
 * the zone table's tab and page, and the log's filter and page. Like the other pages' addresses, it is the state, so a
 * reload or a shared link opens the same place, and a value that is not allowed falls back to the default. What is typed
 * in the form (the value, the times) and the draft are not in it: they live in the page. Parameters that are not the
 * Lab's are left alone.
 */

export interface LabQuery {
  scope: TargetScope;
  /** Device ids, zone codes or classes, by scope, in the order chosen. */
  targets: string[];
  /** The zone selected in the list (above 60 devices), or `null`. */
  zone: string | null;
  tab: ZoneTab;
  /** The zone table's page, 1-based. */
  page: number;
  log: LogFilter;
  /** The log's page, 1-based. */
  logPage: number;
}

export const DEFAULT_LAB_QUERY: LabQuery = {
  scope: 'device',
  targets: [],
  zone: null,
  tab: 'all',
  page: 1,
  log: 'all',
  logPage: 1,
};

/** Rows of the zone table, and of the log, on a page. */
export const LAB_TABLE_SIZE = 10;
export const LAB_LOG_SIZE = 5;

const MAX_TARGETS = 200;
const MAX_NAME_LENGTH = 64;
const KEYS = ['scope', 'target', 'zone', 'tab', 'page', 'log', 'logPage'] as const;

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.includes(value as T) ? (value as T) : null;

const pageOf = (value: string | null): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

export function readLabQuery(params: URLSearchParams): LabQuery {
  const targets = [
    ...new Set(
      params
        .getAll('target')
        .map((target) => target.slice(0, MAX_NAME_LENGTH))
        .filter((target) => target !== ''),
    ),
  ].slice(0, MAX_TARGETS);
  return {
    scope: oneOf(params.get('scope'), TARGET_SCOPES) ?? DEFAULT_LAB_QUERY.scope,
    targets,
    zone: (params.get('zone') ?? '').slice(0, MAX_NAME_LENGTH) || null,
    tab: oneOf(params.get('tab'), ZONE_TABS) ?? DEFAULT_LAB_QUERY.tab,
    page: pageOf(params.get('page')),
    log: oneOf(params.get('log'), LOG_FILTERS) ?? DEFAULT_LAB_QUERY.log,
    logPage: pageOf(params.get('logPage')),
  };
}

/** Writes the Lab's parameters into `params` (a copy is returned), leaving out those that have their default. */
export function writeLabQuery(params: URLSearchParams, query: LabQuery): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of KEYS) next.delete(key);
  if (query.scope !== DEFAULT_LAB_QUERY.scope) next.set('scope', query.scope);
  for (const target of query.targets) next.append('target', target);
  if (query.zone !== null) next.set('zone', query.zone);
  if (query.tab !== DEFAULT_LAB_QUERY.tab) next.set('tab', query.tab);
  if (query.page !== 1) next.set('page', String(query.page));
  if (query.log !== DEFAULT_LAB_QUERY.log) next.set('log', query.log);
  if (query.logPage !== 1) next.set('logPage', String(query.logPage));
  return next;
}

/**
 * The query without what the registry does not have: a link can name a device that is gone, or a zone that does not
 * exist. Pages are left as they are (the lists clamp them).
 */
export function sanitizeLabQuery(query: LabQuery, devices: readonly DeviceInfo[]): LabQuery {
  const zones = new Set(devices.map((device) => device.zoneCode));
  return {
    ...query,
    targets: pruneTargets(devices, query.scope, query.targets),
    zone: query.zone !== null && zones.has(query.zone) ? query.zone : null,
  };
}

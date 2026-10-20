import type { Severity } from '../api/types';

/** Alerts per page; ingest allows 1 to 200 and the ticket 5 to 200. */
export const ALERT_PAGE_SIZES = [5, 10, 25, 50, 100, 200] as const;
export const DEFAULT_ALERT_PAGE_SIZE = 25;

export type AlertStatusFilter = 'open' | 'all';
export type SeverityFilter = Severity | 'all';

export const SEVERITY_FILTERS: readonly SeverityFilter[] = [
  'all',
  'critical',
  'high',
  'medium',
  'low',
];

/**
 * What the Alerts page shows, as the address carries it. The cursor is not part of it: it is a value the API
 * handed out, kept in memory, so a reload or a shared link opens the newest alerts.
 */
export interface AlertsQuery {
  /** `open` asks ingest for open alerts only; `all` sends no status. */
  status: AlertStatusFilter;
  /** Hides rows of the loaded page; ingest has no severity parameter. */
  severity: SeverityFilter;
  size: number;
  /** The alert whose detail is open, by id. */
  alert: string | null;
}

export const DEFAULT_ALERTS_QUERY: AlertsQuery = {
  status: 'all',
  severity: 'all',
  size: DEFAULT_ALERT_PAGE_SIZE,
  alert: null,
};

/** Ids are `bigint` strings; this only stops a hand-edited address from putting a paragraph in the page. */
const ALERT_ID_MAX_LENGTH = 40;

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  allowed.find((candidate) => candidate === value) ?? null;

/**
 * Reads the address. A value that is not one of the allowed ones falls back to the default instead of failing:
 * a link that was shared with an old or hand-edited address still opens the page.
 */
export function parseAlertsQuery(params: URLSearchParams): AlertsQuery {
  const size = Number(params.get('size'));
  return {
    status: oneOf(params.get('status'), ['open', 'all'] as const) ?? DEFAULT_ALERTS_QUERY.status,
    severity: oneOf(params.get('severity'), SEVERITY_FILTERS) ?? DEFAULT_ALERTS_QUERY.severity,
    size: (ALERT_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_ALERT_PAGE_SIZE,
    alert: (params.get('alert') ?? '').slice(0, ALERT_ID_MAX_LENGTH) || null,
  };
}

/** Writes the address with only what differs from the default, so the plain page has a plain address. */
export function serializeAlertsQuery(query: AlertsQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.status !== DEFAULT_ALERTS_QUERY.status) params.set('status', query.status);
  if (query.severity !== DEFAULT_ALERTS_QUERY.severity) params.set('severity', query.severity);
  if (query.size !== DEFAULT_ALERT_PAGE_SIZE) params.set('size', String(query.size));
  if (query.alert) params.set('alert', query.alert);
  return params;
}

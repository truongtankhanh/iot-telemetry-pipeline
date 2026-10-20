import type { ObservedAlert, PagedAlert, Severity } from '../api/types';
import type { SeverityFilter } from './alertsQuery';

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

/** A severity ingest sends that Studio does not know is drawn as the lowest, not hidden. */
export function severityOf(value: string): Severity {
  return (SEVERITIES as readonly string[]).includes(value) ? (value as Severity) : 'low';
}

/** How far Studio saw an alert get: observed times are only ever filled in, so more means later. */
function progress(alert: ObservedAlert): number {
  const { openedAt, clearedAt, delivered, incident } = alert.observed;
  return [
    alert.status === 'cleared',
    openedAt,
    clearedAt,
    delivered.opened,
    delivered.cleared,
    incident,
  ].filter((fact) => fact !== null && fact !== false).length;
}

/**
 * Puts what changed since a page was fetched onto its rows. A page is a snapshot; the store hears about a delivery
 * or a clear a second after it happens, so a row of an older page would say "pending" for as long as it stays on
 * show. The store's copy replaces the row's ingest fields and observed times only when it is **ahead** (it saw
 * more happen): a copy that is older than the page, because the page was fetched since, never wins. The cause is
 * the page's, since the store does not carry one.
 */
export function overlayLive(
  page: readonly PagedAlert[],
  live: readonly ObservedAlert[],
): PagedAlert[] {
  if (live.length === 0) return [...page];
  const byId = new Map(live.map((alert) => [alert.id, alert]));
  return page.map((row) => {
    const fresher = byId.get(row.id);
    if (fresher === undefined || progress(fresher) <= progress(row)) return row;
    return { ...fresher, cause: row.cause };
  });
}

/** Rows of the page on show that pass the severity filter. Ingest cannot filter by severity: this hides rows only. */
export function filterBySeverity<T extends { severity: string }>(
  rows: readonly T[],
  severity: SeverityFilter,
): T[] {
  return severity === 'all'
    ? [...rows]
    : rows.filter((row) => severityOf(row.severity) === severity);
}

/** Said under the list when the severity filter hides rows, so a short page is not mistaken for the end. */
export function filterNote(shown: number, loaded: number): string | null {
  return shown === loaded ? null : `Filtering this page: ${shown} of ${loaded} shown.`;
}

/** The fields of `GET /api/alerts` of ingest (`docs/api.md`), in the documented order, for _Copy as JSON_. */
export function ingestFields(alert: PagedAlert) {
  return {
    id: alert.id,
    deviceId: alert.deviceId,
    ruleId: alert.ruleId,
    metric: alert.metric,
    severity: alert.severity,
    title: alert.title,
    status: alert.status,
    openedAt: alert.openedAt,
    openedValue: alert.openedValue,
    clearedAt: alert.clearedAt,
    clearedValue: alert.clearedValue,
    externalRef: alert.externalRef,
    deliveryStatus: alert.deliveryStatus,
    deliveryAttempts: alert.deliveryAttempts,
    deliveryError: alert.deliveryError,
  };
}

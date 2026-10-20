import type { ObservationDraft } from './observation-store.ts';

/** An alert as `GET /api/alerts` of ingest returns it (docs/api.md). */
export interface IngestAlert {
  id: string;
  deviceId: string;
  ruleId: string;
  metric: string;
  severity: string;
  title: string;
  status: 'open' | 'cleared';
  openedAt: string;
  openedValue: number | null;
  clearedAt: string | null;
  clearedValue: number | null;
  /** The incident id in the command center, once the opened event was delivered. */
  externalRef: string | null;
  /** State of the alert's latest outbox event: the opened one, or the cleared one once it has cleared. */
  deliveryStatus: string | null;
  deliveryAttempts: number | null;
  deliveryError: string | null;
}

type Phase = 'opened' | 'cleared';

/**
 * An alert with the times Studio first saw things happen. Ingest has no delivery timestamp, so
 * these are observed times: within one polling interval of the truth, and `null` when Studio did
 * not see it (an alert already there when Studio started has no observed opening).
 */
export interface ObservedAlert extends IngestAlert {
  /** Already in ingest at the first poll: Studio did not see it open. */
  preexisting: boolean;
  observed: {
    openedAt: string | null;
    clearedAt: string | null;
    /** When the outbox delivery of each event was first seen as `delivered`. */
    delivered: Record<Phase, string | null>;
    /** When the incident id first appeared. */
    incident: string | null;
  };
}

export interface AlertObservation {
  /** What changed since the last call, oldest alert first. Empty on the first call. */
  events: ObservationDraft[];
  /** Every alert kept, newest opened first. */
  view: ObservedAlert[];
  /** True when something in `view` differs from the last call. */
  changed: boolean;
}

/** Alerts kept for the session; the oldest opened are forgotten first. */
export const ALERT_CAP = 500;

const STATUSES = ['open', 'cleared'];

const isString = (value: unknown): value is string => typeof value === 'string';
const stringOrNull = (value: unknown): string | null | undefined =>
  value === null || value === undefined ? null : isString(value) ? value : undefined;
const numberOrNull = (value: unknown): number | null | undefined =>
  value === null || value === undefined ? null : typeof value === 'number' ? value : undefined;

function parseAlert(item: unknown): IngestAlert | undefined {
  if (typeof item !== 'object' || item === null) return undefined;
  const r = item as Record<string, unknown>;
  const { id, deviceId, ruleId, metric, severity, title, status, openedAt } = r;
  if (
    !isString(id) ||
    !isString(deviceId) ||
    !isString(ruleId) ||
    !isString(metric) ||
    !isString(severity) ||
    !isString(title) ||
    !isString(status) ||
    !STATUSES.includes(status) ||
    !isString(openedAt)
  ) {
    return undefined;
  }
  const openedValue = numberOrNull(r.openedValue);
  const clearedAt = stringOrNull(r.clearedAt);
  const clearedValue = numberOrNull(r.clearedValue);
  const externalRef = stringOrNull(r.externalRef);
  const deliveryStatus = stringOrNull(r.deliveryStatus);
  const deliveryAttempts = numberOrNull(r.deliveryAttempts);
  const deliveryError = stringOrNull(r.deliveryError);
  if (
    openedValue === undefined ||
    clearedAt === undefined ||
    clearedValue === undefined ||
    externalRef === undefined ||
    deliveryStatus === undefined ||
    deliveryAttempts === undefined ||
    deliveryError === undefined
  ) {
    return undefined;
  }
  return {
    id,
    deviceId,
    ruleId,
    metric,
    severity,
    title,
    status: status as IngestAlert['status'],
    openedAt,
    openedValue,
    clearedAt,
    clearedValue,
    externalRef,
    deliveryStatus,
    deliveryAttempts,
    deliveryError,
  };
}

/**
 * Reads the body of `GET /api/alerts`. Returns `undefined` unless every element has the documented
 * shape: a reply that does not is treated as a failed read, never as a partial list.
 */
export function parseAlerts(body: unknown): IngestAlert[] | undefined {
  if (!Array.isArray(body)) return undefined;
  const alerts: IngestAlert[] = [];
  for (const item of body) {
    const alert = parseAlert(item);
    if (!alert) return undefined;
    alerts.push(alert);
  }
  return alerts;
}

interface Tracked {
  view: ObservedAlert;
  seen: { delivery: Partial<Record<Phase, string>>; externalRef: string | null };
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Ids are bigint strings: compare by length, then text. */
const compareIds = (a: string, b: string) => a.length - b.length || compareText(a, b);
const oldestFirst = (a: IngestAlert, b: IngestAlert) =>
  compareText(a.openedAt, b.openedAt) || compareIds(a.id, b.id);

const WATCHED = [
  'status',
  'clearedAt',
  'clearedValue',
  'externalRef',
  'deliveryStatus',
  'deliveryAttempts',
  'deliveryError',
] as const;

/**
 * Turns successive reads of ingest's alerts into the facts Studio can honestly claim: when it
 * first saw an alert open or clear, its delivery become `delivered` and an incident id appear.
 *
 * The first read is a baseline: the alerts already in ingest's database (from an earlier run) are
 * listed as `preexisting`, with no observed times and no events. Delivery is tracked per alert and
 * per phase because `deliveryStatus` describes only the latest outbox event: when an alert clears,
 * the cleared event's status replaces the opened one's, and the opened delivery must not be lost.
 */
export class AlertObserver {
  private readonly tracked = new Map<string, Tracked>();
  private baselined = false;

  observe(alerts: IngestAlert[], at: string): AlertObservation {
    const events: ObservationDraft[] = [];
    let changed = !this.baselined;

    for (const alert of [...alerts].sort(oldestFirst)) {
      const known = this.tracked.get(alert.id);
      if (!this.baselined) {
        this.tracked.set(alert.id, this.baseline(alert));
      } else if (!known) {
        this.tracked.set(alert.id, this.first(alert, at, events));
        changed = true;
      } else if (this.update(known, alert, at, events)) {
        changed = true;
      }
    }

    this.baselined = true;
    return { events, view: this.view(), changed };
  }

  /** Every alert kept, newest opened first. Forgets what is beyond `ALERT_CAP`. */
  view(): ObservedAlert[] {
    const sorted = [...this.tracked.values()].sort(
      (a, b) => compareText(b.view.openedAt, a.view.openedAt) || compareIds(b.view.id, a.view.id),
    );
    for (const { view } of sorted.slice(ALERT_CAP)) this.tracked.delete(view.id);
    return sorted.slice(0, ALERT_CAP).map(({ view }) => ({
      ...view,
      observed: { ...view.observed, delivered: { ...view.observed.delivered } },
    }));
  }

  private baseline(alert: IngestAlert): Tracked {
    const phase: Phase = alert.status === 'open' ? 'opened' : 'cleared';
    const delivery: Partial<Record<Phase, string>> = {};
    if (alert.deliveryStatus !== null) delivery[phase] = alert.deliveryStatus;
    return {
      view: {
        ...alert,
        preexisting: true,
        observed: {
          openedAt: null,
          clearedAt: null,
          delivered: { opened: null, cleared: null },
          incident: null,
        },
      },
      seen: { delivery, externalRef: alert.externalRef },
    };
  }

  /** An alert not seen before, after the baseline: it opened (and maybe cleared) since the last read. */
  private first(alert: IngestAlert, at: string, events: ObservationDraft[]): Tracked {
    const tracked: Tracked = {
      view: {
        ...alert,
        preexisting: false,
        observed: {
          openedAt: at,
          clearedAt: alert.status === 'cleared' ? at : null,
          delivered: { opened: null, cleared: null },
          incident: null,
        },
      },
      seen: { delivery: {}, externalRef: null },
    };
    const { id, deviceId, ruleId, metric, severity, title } = alert;
    events.push({
      kind: 'alert-opened',
      data: { alertId: id, deviceId, ruleId, metric, severity, title },
    });
    if (alert.status === 'cleared') {
      events.push({ kind: 'alert-cleared', data: { alertId: id, deviceId, ruleId, title } });
    }
    this.observeDelivery(tracked, alert, at, events);
    this.observeIncident(tracked, alert, at, events);
    return tracked;
  }

  /** Returns true when anything about the alert differs from the last read. */
  private update(
    tracked: Tracked,
    alert: IngestAlert,
    at: string,
    events: ObservationDraft[],
  ): boolean {
    const before = tracked.view;
    const changed = WATCHED.some((key) => before[key] !== alert[key]);

    if (before.status === 'open' && alert.status === 'cleared') {
      tracked.view.observed.clearedAt = at;
      const { id, deviceId, ruleId, title } = alert;
      events.push({ kind: 'alert-cleared', data: { alertId: id, deviceId, ruleId, title } });
    }
    tracked.view = { ...before, ...alert };
    this.observeDelivery(tracked, alert, at, events);
    this.observeIncident(tracked, alert, at, events);
    return changed;
  }

  private observeDelivery(
    tracked: Tracked,
    alert: IngestAlert,
    at: string,
    events: ObservationDraft[],
  ): void {
    const status = alert.deliveryStatus;
    if (status === null) return;
    const phase: Phase = alert.status === 'open' ? 'opened' : 'cleared';
    if (tracked.seen.delivery[phase] === status) return;
    tracked.seen.delivery[phase] = status;
    events.push({ kind: 'delivery', data: { alertId: alert.id, phase, status } });
    if (status === 'delivered' && tracked.view.observed.delivered[phase] === null) {
      tracked.view.observed.delivered[phase] = at;
    }
  }

  private observeIncident(
    tracked: Tracked,
    alert: IngestAlert,
    at: string,
    events: ObservationDraft[],
  ): void {
    if (alert.externalRef === null || tracked.seen.externalRef !== null) return;
    tracked.seen.externalRef = alert.externalRef;
    tracked.view.observed.incident = at;
    events.push({
      kind: 'incident',
      data: { alertId: alert.id, externalRef: alert.externalRef },
    });
  }
}

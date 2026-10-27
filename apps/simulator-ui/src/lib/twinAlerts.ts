import type { AlertsFeed, ObservedAlert, Severity } from '../api/types';

/**
 * What the twin says of the alerts that are open on a device: one mark per device (the beacon on its pin, the chip on its
 * label, a line of the text list). Nothing here imports three.js or React.
 */

/** Worst first. The only loud colours in Studio mean severity and nothing else (`--sev-*` in `tokens.css`). */
export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

/**
 * `ObservedAlert.severity` is a plain string (ingest's), so an unknown one is not trusted to be a `Severity`: it ranks
 * below `low` and is drawn as `low`. The alert is never dropped for it.
 */
function rankOf(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity as Severity);
  return index === -1 ? SEVERITY_ORDER.length : index;
}

const asSeverity = (severity: string): Severity =>
  SEVERITY_ORDER.includes(severity as Severity) ? (severity as Severity) : 'low';

export interface AlertMark {
  /** The alert's id, as the Alerts page writes it (`#7`). */
  id: string;
  severity: Severity;
  /** How many alerts are open on the device; the mark shows the worst. */
  count: number;
  /** Ingest's alerts were not read just now: the mark is the last read, and says so. */
  stale: boolean;
}

/** Milliseconds since the epoch, or `-Infinity` for a time that does not parse, so it loses a tie. */
const openedAtOf = (alert: ObservedAlert): number => {
  const at = Date.parse(alert.openedAt);
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
};

/**
 * The mark of every device that has an open alert: its **worst-severity** open alert, and among equals the newest.
 * A cleared alert has no mark: the beacon goes with the alert.
 */
export function alertMarks(feed: AlertsFeed): Map<string, AlertMark> {
  const best = new Map<string, { alert: ObservedAlert; count: number }>();
  for (const alert of feed.alerts) {
    if (alert.status !== 'open') continue;
    const held = best.get(alert.deviceId);
    if (held === undefined) {
      best.set(alert.deviceId, { alert, count: 1 });
      continue;
    }
    held.count += 1;
    const worse = rankOf(alert.severity) - rankOf(held.alert.severity);
    if (worse < 0 || (worse === 0 && openedAtOf(alert) > openedAtOf(held.alert))) {
      held.alert = alert;
    }
  }
  const marks = new Map<string, AlertMark>();
  for (const [deviceId, { alert, count }] of best) {
    marks.set(deviceId, {
      id: alert.id,
      severity: asSeverity(alert.severity),
      count,
      stale: feed.stale,
    });
  }
  return marks;
}

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** The chip on a label (frame 14): `High · #7`. */
export function chipText(mark: Pick<AlertMark, 'id' | 'severity'>): string {
  return `${capitalise(mark.severity)} · #${mark.id}`;
}

/** The mark in words, for the text list, the tooltip and the card: `alert #7 high, +1 more`. */
export function alertWords(mark: AlertMark): string {
  const more = mark.count > 1 ? `, +${mark.count - 1} more` : '';
  const stale = mark.stale ? ' (last read: alerts are not being read now)' : '';
  return `alert #${mark.id} ${mark.severity}${more}${stale}`;
}

/** "1 high, 2 low": the open alerts of some devices, by severity, worst first; `none` when there is none. */
export function openAlertsWords(
  alerts: readonly ObservedAlert[],
  deviceIds: ReadonlySet<string>,
): string {
  const bySeverity = new Map<string, number>();
  for (const alert of alerts) {
    if (alert.status !== 'open' || !deviceIds.has(alert.deviceId)) continue;
    bySeverity.set(alert.severity, (bySeverity.get(alert.severity) ?? 0) + 1);
  }
  if (bySeverity.size === 0) return 'none';
  return SEVERITY_ORDER.filter((severity) => bySeverity.has(severity))
    .map((severity) => `${bySeverity.get(severity)} ${severity}`)
    .join(', ');
}

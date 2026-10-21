import { Link } from 'react-router';
import type { ObservedAlert } from '../../api/types';
import { severityOf } from '../../lib/alertRows';
import { metricUnit } from '../../lib/deviceIdentity';
import { formatClockTime } from '../../lib/time';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { toneIcons } from '../../ui/icons';
import { SeverityBadge } from '../../ui/SeverityBadge';
import styles from './overview.module.css';

/** How many alerts the feed shows (D13); the Alerts page has the rest. */
export const FEED_SIZE = 5;

export interface AlertFeedProps {
  /** The alerts of the store's feed, newest first. */
  alerts: readonly ObservedAlert[];
  /** Why the alerts are not known now, or `null`. The last known ones are then shown dimmed, with the reason. */
  unknownReason: string | null;
}

function valueOf(alert: ObservedAlert): string | null {
  const value =
    alert.status === 'open' ? alert.openedValue : (alert.clearedValue ?? alert.openedValue);
  if (value === null) return null;
  const unit = metricUnit(alert.metric);
  return `${value}${unit === '' ? '' : ` ${unit}`}`;
}

/**
 * The newest alerts, from the same feed the Alerts page and the Topology read (frame 11): severity, whether it is
 * open or cleared, when it opened, what it is, where, and the incident it became. A row opens that alert on the
 * Alerts page. When ingest does not answer the list is the last one Studio saw, dimmed, and says so.
 */
export function AlertFeed({ alerts, unknownReason }: AlertFeedProps) {
  const shown = alerts.slice(0, FEED_SIZE);
  return (
    <Card
      title="Alerts"
      aside={
        <Link className={styles.link} to="/alerts">
          View all
        </Link>
      }
    >
      {unknownReason === null ? null : (
        <p className={styles.hint} role="status">
          Alerts are unknown: {unknownReason}.
          {shown.length > 0 ? ' The last ones seen are shown dimmed.' : ''}
        </p>
      )}
      {shown.length === 0 ? (
        unknownReason === null ? (
          <p className={styles.hint}>No alert has been raised yet.</p>
        ) : null
      ) : (
        <ul className={styles.feed} data-dimmed={unknownReason === null ? undefined : 'true'}>
          {shown.map((alert) => {
            const opened = Date.parse(alert.openedAt);
            const value = valueOf(alert);
            return (
              <li key={alert.id} className={styles.feedItem} data-status={alert.status}>
                <div className={styles.feedHead}>
                  <SeverityBadge severity={severityOf(alert.severity)} />
                  {alert.status === 'open' ? (
                    <Chip tone="warn">Open</Chip>
                  ) : (
                    <Chip tone="ok" icon={toneIcons.ok}>
                      Cleared
                    </Chip>
                  )}
                  <time className={styles.feedTime} dateTime={alert.openedAt}>
                    {Number.isFinite(opened) ? formatClockTime(opened) : alert.openedAt}
                  </time>
                </div>
                <Link
                  className={styles.feedTitle}
                  to={`/alerts?alert=${encodeURIComponent(alert.id)}`}
                >
                  {alert.title}
                </Link>
                <div className={styles.feedMeta}>
                  <span className={styles.mono}>{alert.deviceId}</span>
                  {value === null ? '' : ` · ${value}`}
                  {alert.externalRef === null ? (
                    ''
                  ) : (
                    <>
                      {' · incident '}
                      <span className={styles.mono}>{alert.externalRef.slice(0, 4)}…</span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

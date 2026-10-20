import { useState } from 'react';
import type { ObservedAlert } from '../../api/types';
import { formatClockTime } from '../../lib/time';
import { consoleHref } from '../../lib/topologyDetail';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { toneIcons } from '../../ui/icons';
import { Segmented } from '../../ui/Segmented';
import { SeverityBadge } from '../../ui/SeverityBadge';
import styles from './detail.module.css';

/** More than this many alerts and the rest is a count: paging them is the Alerts page's job (SIM-07). */
const SHOWN = 5;

export interface AlertsCardProps {
  /** The alerts of the subject, newest first (a device's, a zone's, or all of them for a stage). */
  alerts: readonly ObservedAlert[];
  /** What they are the alerts of: "dc-env-01", "BLD-DC", "all devices". */
  scope: string;
  /** The command center's console, for the link beside an incident id; `null` shows the plain id only. */
  consoleUrl: string | null;
  /** Ingest does not answer: the alerts are the last it said, dimmed and dated (ms of the last good read). */
  asOf: number | null;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function Delivery({ alert }: { alert: ObservedAlert }) {
  const attempts =
    alert.deliveryAttempts === null ? '' : ` · ${plural(alert.deliveryAttempts, 'attempt')}`;
  switch (alert.deliveryStatus) {
    case 'delivered':
      return (
        <Chip tone="ok" icon={toneIcons.ok}>
          Delivered{attempts}
        </Chip>
      );
    case 'pending':
      return <Chip tone="warn">Pending{attempts}</Chip>;
    case 'failed':
      return (
        <Chip tone="bad" icon={toneIcons.bad}>
          Failed{attempts}
          {alert.deliveryError ? ` · ${alert.deliveryError}` : ''}
        </Chip>
      );
    case 'skipped':
      return <Chip>Skipped</Chip>;
    default:
      // A status ingest adds later, or none: said as unknown, never as delivered.
      return <Chip>Delivery unknown</Chip>;
  }
}

/**
 * The alerts of what is selected (frame 04, third column), Open or All, each with its severity, status, the device and
 * value, its delivery and, when the command center has an incident for it, the incident's id. With a console URL set,
 * a link goes to the console; the plain id is always there. After ingest stops answering the card is dimmed and says
 * "As of hh:mm:ss" (frame 10): Studio shows the last answer, never a guess.
 */
export function AlertsCard({ alerts, scope, consoleUrl, asOf }: AlertsCardProps) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const open = alerts.filter((alert) => alert.status === 'open');
  const listed = filter === 'open' ? open : alerts;
  const shown = listed.slice(0, SHOWN);
  const href = consoleHref(consoleUrl);

  return (
    <Card
      title="Alerts"
      aside={
        <>
          {asOf === null ? null : <Chip>As of {formatClockTime(asOf)}</Chip>}
          <Segmented
            label="Status"
            value={filter}
            onChange={(value) => setFilter(value === 'all' ? 'all' : 'open')}
            options={[
              { value: 'open', label: `Open ${open.length}` },
              { value: 'all', label: `All ${alerts.length}` },
            ]}
          />
        </>
      }
    >
      <div className={styles.alerts} data-dimmed={asOf === null ? undefined : 'true'}>
        {shown.length === 0 ? (
          <p className={styles.muted}>
            {filter === 'open'
              ? `No open alert for ${scope}.`
              : `No alert has been raised for ${scope}.`}
          </p>
        ) : (
          <ul className={styles.alertList} aria-label={`Alerts of ${scope}`}>
            {shown.map((alert) => (
              <li
                key={alert.id}
                className={styles.alert}
                data-open={alert.status === 'open' ? 'true' : undefined}
              >
                <div className={styles.alertHead}>
                  <SeverityBadge severity={severityOf(alert.severity)} />
                  {alert.status === 'open' ? (
                    <Chip tone="warn">Open</Chip>
                  ) : (
                    <Chip tone="ok" icon={toneIcons.ok}>
                      Cleared
                    </Chip>
                  )}
                  <span className={styles.mono}>#{alert.id}</span>
                </div>
                <div className={styles.alertTitle}>{alert.title}</div>
                <div className={styles.muted}>
                  <span className={styles.mono}>{alert.deviceId}</span>
                  {alert.openedValue === null ? '' : ` · ${alert.openedValue}`} · opened{' '}
                  {formatClockTime(Date.parse(alert.openedAt))}
                  {alert.clearedAt === null
                    ? ''
                    : ` · cleared ${formatClockTime(Date.parse(alert.clearedAt))}${alert.clearedValue === null ? '' : ` at ${alert.clearedValue}`}`}
                </div>
                <div className={styles.alertFoot}>
                  <Delivery alert={alert} />
                  {alert.externalRef ? (
                    <span className={styles.incident}>
                      Incident <span className={styles.mono}>{alert.externalRef.slice(0, 8)}…</span>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer">
                          Open the command center
                        </a>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {listed.length > SHOWN ? (
          <p className={styles.muted}>and {listed.length - SHOWN} more</p>
        ) : null}
      </div>
    </Card>
  );
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
/** A severity ingest sends that Studio does not know is drawn as the lowest, not hidden. */
function severityOf(value: string): (typeof SEVERITIES)[number] {
  return (SEVERITIES as readonly string[]).includes(value)
    ? (value as (typeof SEVERITIES)[number])
    : 'low';
}

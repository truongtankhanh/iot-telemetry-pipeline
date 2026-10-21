import type { ReactNode } from 'react';
import type { Severity } from '../../api/types';
import type { KpiTone, OverviewKpis as Kpis } from '../../lib/overviewKpis';
import { Icon } from '../../ui/Icon';
import { toneIcons } from '../../ui/icons';
import { SeverityBadge } from '../../ui/SeverityBadge';
import styles from './overview.module.css';

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface KpiProps {
  label: string;
  tone: KpiTone;
  /** The figure; `null` is unknown, drawn as the word, with the reason as the note. */
  value: ReactNode | null;
  unit?: string;
  /** Under the figure: a bar, a list of severities. */
  extra?: ReactNode;
  note: ReactNode;
}

/**
 * One figure: its label, the number a person can read from across a room, and a line of words under it. A tone other
 * than ok has an icon beside the label, and an unknown figure says "unknown" and why: never colour alone, never a zero.
 */
function Kpi({ label, tone, value, unit, extra, note }: KpiProps) {
  const unknown = value === null;
  const icon = unknown ? 'unknown' : tone === 'warn' || tone === 'bad' ? tone : null;
  return (
    <div className={styles.kpi} data-tone={unknown ? 'unknown' : tone}>
      <dt>
        {icon ? <Icon glyph={toneIcons[icon]} size="sm" /> : null}
        {label}
      </dt>
      <dd className={styles.kpiValue} data-unknown={unknown ? 'true' : undefined}>
        {unknown ? (
          'unknown'
        ) : (
          <>
            {value}
            {unit ? <span className={styles.kpiUnit}> {unit}</span> : null}
          </>
        )}
      </dd>
      {extra ? <dd>{extra}</dd> : null}
      <dd className={styles.kpiNote}>{note}</dd>
    </div>
  );
}

/** The share of the registered devices that run, pause and stop, as a bar with the same numbers in its name. */
function Availability({
  running,
  paused,
  stopped,
}: {
  running: number;
  paused: number;
  stopped: number;
}) {
  const total = running + paused + stopped;
  if (total === 0) return null;
  const parts = [
    { id: 'running', n: running },
    { id: 'paused', n: paused },
    { id: 'stopped', n: stopped },
  ];
  return (
    <div
      className={styles.availability}
      role="img"
      aria-label={`${running} running, ${paused} paused, ${stopped} stopped`}
    >
      {parts
        .filter((part) => part.n > 0)
        .map((part) => (
          <i key={part.id} data-state={part.id} style={{ width: `${(part.n / total) * 100}%` }} />
        ))}
    </div>
  );
}

export interface OverviewKpisProps {
  kpis: Kpis;
}

/**
 * The first row of the Overview (frame 11): six figures, each from the source its detail page reads, so the two agree.
 * A source that does not answer makes its figure unknown (not zero) and says why in the note.
 */
export function OverviewKpis({ kpis }: OverviewKpisProps) {
  const { devices, alerts, rate, lag, delivery, notReporting } = kpis;

  const away = [
    devices.paused > 0 ? `${devices.paused} paused` : null,
    devices.stopped > 0 ? `${devices.stopped} stopped` : null,
  ].filter((part): part is string => part !== null);

  const shown = notReporting.devices.slice(0, 2);
  const more = notReporting.devices.length - shown.length;

  return (
    <dl className={styles.kpis} aria-label="Key figures">
      <Kpi
        label="Devices online"
        tone={devices.tone}
        value={devices.total === 0 ? null : devices.online}
        unit={devices.total === 0 ? undefined : `of ${devices.total}`}
        extra={
          <Availability
            running={devices.online}
            paused={devices.paused}
            stopped={devices.stopped}
          />
        }
        note={
          devices.total === 0
            ? 'no device is registered'
            : `${devices.availability}% availability${away.length > 0 ? ` · ${away.join(', ')}` : ''}`
        }
      />

      <Kpi
        label="Active alerts"
        tone={alerts.known ? alerts.tone : 'unknown'}
        value={alerts.known ? alerts.open : null}
        extra={
          alerts.known && alerts.open > 0 ? (
            <span className={styles.severities}>
              {SEVERITIES.filter((severity) => alerts.bySeverity[severity] > 0).map((severity) => (
                <span key={severity}>
                  <SeverityBadge severity={severity} /> {alerts.bySeverity[severity]}
                </span>
              ))}
            </span>
          ) : null
        }
        note={
          alerts.known
            ? `${alerts.open === 0 ? 'none open' : 'open now'}${alerts.feedFull ? ' · of the newest 100 alerts' : ''}`
            : alerts.reason
        }
      />

      <Kpi
        label="Message rate"
        tone={rate.tone}
        value={rate.perSecond.toFixed(1)}
        unit="msg/s"
        note={[
          `${rate.perMinute} per minute`,
          rate.sequenceGaps === null
            ? 'sequence gaps unknown'
            : plural(rate.sequenceGaps, 'sequence gap'),
          ...(rate.note ? [rate.note] : []),
        ].join(' · ')}
      />

      <Kpi
        label="Ingest lag"
        tone={lag.known ? lag.tone : 'unknown'}
        value={lag.known ? lag.text : null}
        unit="s"
        note={lag.known ? 'time from measurement to storage' : lag.reason}
      />

      <Kpi
        label="Alert delivery"
        tone={delivery.known ? delivery.tone : 'unknown'}
        value={delivery.known ? delivery.delivered : null}
        unit={delivery.known ? `of ${delivery.total}` : undefined}
        note={
          delivery.known
            ? `delivered · ${delivery.pending} pending · ${delivery.failed} failed`
            : delivery.reason
        }
      />

      <Kpi
        label="Not reporting"
        tone={notReporting.tone}
        value={notReporting.count}
        note={
          notReporting.count === 0 ? (
            'every device is reporting'
          ) : (
            <>
              {shown.map((device, index) => (
                <span key={device.id}>
                  {index > 0 ? ' · ' : ''}
                  <span className={styles.mono}>{device.id}</span> {device.word}
                </span>
              ))}
              {more > 0 ? ` · + ${more} more` : ''}
            </>
          )
        }
      />
    </dl>
  );
}

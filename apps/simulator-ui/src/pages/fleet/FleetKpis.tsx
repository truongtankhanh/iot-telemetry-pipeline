import type { StateView } from '../../api/types';
import { formatClockTime } from '../../lib/time';
import styles from './fleet.module.css';

export interface FleetKpisProps {
  view: StateView;
  /** Messages per second the stream is carrying. */
  publishRate: number;
  now: number;
}

const count = (n: number, noun: string) => `${n} ${noun}`;

/**
 * Four figures over the list (frame 01): how much has been published, at what rate, how many devices are
 * running, and how many values are held. Each is a number a person can read from across a room, with a line of
 * words under it. A fourth that is not measured (the broker's acknowledgement time) is not shown; see the ADR.
 */
export function FleetKpis({ view, publishRate, now }: FleetKpisProps) {
  const { engine } = view;
  const devices = engine.devices;
  const running = devices.filter((d) => d.state === 'running').length;
  const paused = devices.filter((d) => d.state === 'paused').length;
  const stopped = devices.filter((d) => d.state === 'stopped').length;
  const held = devices.reduce((sum, d) => sum + Object.keys(d.holds).length, 0);
  const heldOn = devices.filter((d) => Object.keys(d.holds).length > 0).length;
  const since = formatClockTime(now - engine.elapsedS * 1000);
  const interval = view.config.intervalMs / 1000;

  const away = [
    paused > 0 ? count(paused, 'paused') : null,
    stopped > 0 ? count(stopped, 'stopped') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

  return (
    <dl className={styles.kpis}>
      <div className={styles.kpi}>
        <dt>Published</dt>
        <dd className={styles.kpiValue}>{engine.published.toLocaleString('en-US')}</dd>
        <dd className={styles.kpiNote}>since {since}</dd>
      </div>
      <div className={styles.kpi}>
        <dt>Rate</dt>
        <dd className={styles.kpiValue}>
          {publishRate.toFixed(1)} <span className={styles.kpiUnit}>msg/s</span>
        </dd>
        <dd className={styles.kpiNote}>
          {count(running, running === 1 ? 'device' : 'devices')} × 1 per {interval} s
        </dd>
      </div>
      <div className={styles.kpi}>
        <dt>Active devices</dt>
        <dd className={styles.kpiValue}>
          {running} <span className={styles.kpiUnit}>of {devices.length}</span>
        </dd>
        <dd className={styles.kpiNote}>{away === '' ? 'all running' : away}</dd>
      </div>
      <div className={styles.kpi}>
        <dt>Held values</dt>
        <dd className={styles.kpiValue}>{held}</dd>
        <dd className={styles.kpiNote}>
          {held === 0
            ? 'none; every value is simulated'
            : `on ${count(heldOn, heldOn === 1 ? 'device' : 'devices')}`}
        </dd>
      </div>
    </dl>
  );
}

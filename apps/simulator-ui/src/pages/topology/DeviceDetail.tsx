import { type MetricName, telemetryTopic } from '@itp/telemetry-contract';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import type { MetricProfile, RulesView } from '../../api/types';
import { metricLabel, metricUnit } from '../../lib/deviceIdentity';
import type { FleetRow } from '../../lib/fleetQuery';
import { formatClockTime } from '../../lib/time';
import { formatValue, headroom, rulesFor } from '../../lib/rules';
import { deviceTopologyState, TOPOLOGY_TONES } from '../../lib/topologyState';
import { useSeries } from '../../state/historyContext';
import { LineChart } from '../../ui/charts/LineChart';
import { RangeBar } from '../../ui/charts/RangeBar';
import { Card } from '../../ui/Card';
import { DeviceBadge } from '../../ui/DeviceBadge';
import { Pill } from '../../ui/Pill';
import { tabId } from '../../ui/tabId';
import { Tabs } from '../../ui/Tabs';
import styles from './detail.module.css';

export interface DeviceDetailProps {
  row: FleetRow;
  rules: RulesView;
  /** The generator's baseline, noise and daily swing for each metric of the device (read-only). */
  profiles: Partial<Record<MetricName, MetricProfile>> | undefined;
  intervalMs: number;
  seq: number;
  now: number;
}

/**
 * The device under the graph (frame 04, first column): who it is, the state as a note beside its name, its topic, the
 * chart of the last two minutes for the chosen metric with the rule's lines, and the range bar. The chart carries no
 * alert marker: the state is the word beside the name. A single link goes to the device's inspector in the Fleet; there
 * is no Twin and no Lab link before those pages exist. Call it with `key={deviceId}` so the chosen metric starts again
 * for another device.
 */
export function DeviceDetail({ row, rules, profiles, intervalMs, seq, now }: DeviceDetailProps) {
  const { device, status } = row;
  const uid = useId();
  const panelId = `${uid}-panel`;
  const [chosen, setChosen] = useState(device.metrics[0] ?? '');
  const names: readonly string[] = device.metrics;
  const metric = names.includes(chosen) ? chosen : (names[0] ?? '');
  const series = useSeries(device.id, metric);
  const latest = series.at(-1)?.v ?? null;
  const rule = rulesFor(rules, device, metric)[0] ?? null;
  const standing = rule && latest !== null ? headroom(rule, latest) : null;
  const profile = profiles?.[metric as MetricName] ?? null;
  const unit = metricUnit(metric);
  const detail =
    status.reason ??
    (status.since !== null && status.kind !== 'running'
      ? `since ${formatClockTime(status.since)}`
      : null);

  return (
    <Card
      title={device.id}
      aside={
        <Pill
          label={status.word}
          detail={detail}
          tone={TOPOLOGY_TONES[deviceTopologyState(status.kind)]}
        />
      }
    >
      <div className={styles.who}>
        <DeviceBadge kind={device.kind} code={row.code} state={status.node} />
        <div className={styles.whoText}>
          <span>{row.name}</span>
          <span className={styles.mono}>
            {telemetryTopic({ zoneCode: device.zoneCode, deviceId: device.id })} · seq{' '}
            {seq.toLocaleString('en-US')}
          </span>
        </div>
      </div>

      {device.metrics.length > 1 ? (
        <Tabs
          tabs={device.metrics.map((name) => ({ id: name, label: metricLabel(name) }))}
          value={metric}
          onChange={setChosen}
          label={`Metric of ${device.id}`}
          idPrefix={uid}
          panelId={panelId}
        />
      ) : null}
      <div
        id={panelId}
        className={styles.panel}
        {...(device.metrics.length > 1
          ? { role: 'tabpanel', 'aria-labelledby': tabId(uid, metric) }
          : {})}
      >
        <p className={styles.reading}>
          <span className={styles.big}>{latest === null ? '—' : formatValue(metric, latest)}</span>
          {unit ? <span className={styles.unit}>{unit}</span> : null}
          <span className={styles.mono}>{metric}</span>
          {standing ? <span className={styles.headroom}>{standing.text}</span> : null}
        </p>
        {metric ? (
          <LineChart
            deviceId={device.id}
            metric={metric}
            samples={series}
            now={now}
            rule={rule}
            status={{ kind: status.kind, since: status.since }}
            intervalMs={intervalMs}
            height={190}
          />
        ) : null}
        {rule ? <RangeBar metric={metric} rule={rule} profile={profile} value={latest} /> : null}
        {rule === null ? (
          <p className={styles.muted}>
            {rules.available
              ? 'No rule watches this metric.'
              : `Rules are not available: ${rules.reason ?? 'unknown reason'}.`}
          </p>
        ) : null}
      </div>

      <div className={styles.actions}>
        <Link
          className={styles.actionLink}
          to={`/fleet?device=${encodeURIComponent(device.id)}`}
          aria-label={`Open ${device.id} in the Fleet`}
        >
          Open device
        </Link>
      </div>
    </Card>
  );
}

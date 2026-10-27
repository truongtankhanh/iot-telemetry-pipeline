import { useId, useState } from 'react';
import type { EngineSnapshot, RulesView } from '../../api/types';
import { STATUS_TONES } from '../../lib/deviceStatus';
import { kindLabel, type FleetRow } from '../../lib/fleetQuery';
import { metricIcon, metricLabel, metricUnit } from '../../lib/deviceIdentity';
import { formatValue, rulesFor } from '../../lib/rules';
import { formatClockTime } from '../../lib/time';
import { useSeries } from '../../state/historyContext';
import { useBenchmarkLock } from '../../state/useBenchmarkLock';
import { Button } from '../../ui/Button';
import { LineChart } from '../../ui/charts/LineChart';
import { Chip } from '../../ui/Chip';
import { DeviceBadge } from '../../ui/DeviceBadge';
import { Icon } from '../../ui/Icon';
import { metricIcons, uiIcons } from '../../ui/icons';
import { Pill } from '../../ui/Pill';
import { tabId } from '../../ui/tabId';
import { Tabs } from '../../ui/Tabs';
import styles from './deviceCard.module.css';
import type { DeviceCommands } from './useDeviceCommands';

export interface DeviceCardProps {
  row: FleetRow;
  /** The engine's entry for the device: its state, its interval, its sequence number and its held values. */
  engineDevice: EngineSnapshot['devices'][number] | undefined;
  rules: RulesView;
  now: number;
  /** The inspector is open on this device. */
  selected: boolean;
  commands: DeviceCommands;
  onOpen: (deviceId: string) => void;
  /** 3 when the card is a direct child of the page's "Devices" heading, 4 under a zone heading. */
  headingLevel?: 3 | 4;
}

/**
 * One device (frame 01): who it is and what state it is in, its live values, a chart of the last two minutes for
 * the chosen metric, and start, pause and stop. Every control names the device it acts on. The state is a word
 * and an icon beside the name, never the chart's colour or an alert marker on the line.
 */
export function DeviceCard({
  row,
  engineDevice,
  rules,
  now,
  selected,
  commands,
  onOpen,
  headingLevel = 3,
}: DeviceCardProps) {
  const { device, status } = row;
  const [chosen, setChosen] = useState(device.metrics[0] ?? '');
  // The metric on show; the first one if the choice is no longer one of the device's (the registry can change).
  const names: readonly string[] = device.metrics;
  const metric = names.includes(chosen) ? chosen : (names[0] ?? '');
  const series = useSeries(device.id, metric);
  const rule = rulesFor(rules, device, metric)[0] ?? null;
  const uid = useId();
  const titleId = `${uid}-title`;
  const panelId = `${uid}-panel`;
  const Title = headingLevel === 3 ? 'h3' : 'h4';

  const state = engineDevice?.state ?? 'stopped';
  const busy = commands.isBusy(device.id);
  // A benchmark is running: the simulator refuses to start a device (Pause and Stop stay open); the banner says why.
  const lock = useBenchmarkLock();
  const error = commands.errorOf(device.id);
  const holds = engineDevice?.holds ?? {};
  const detail =
    status.since !== null && status.kind !== 'running' && status.kind !== 'anomaly'
      ? `since ${formatClockTime(status.since)}`
      : null;

  return (
    <article
      className={styles.card}
      aria-labelledby={titleId}
      data-state={status.kind}
      data-selected={selected ? 'true' : undefined}
      aria-busy={busy || undefined}
    >
      <header className={styles.head}>
        <DeviceBadge kind={device.kind} code={row.code} state={status.node} />
        <div className={styles.who}>
          <Title id={titleId} className={styles.name}>
            {row.name}
          </Title>
          <span className={styles.sub}>
            {device.id} · {device.zoneCode}
          </span>
        </div>
        <Pill label={status.word} detail={detail} tone={STATUS_TONES[status.kind]} />
      </header>

      {status.reason ? <p className={styles.reason}>{status.reason}</p> : null}

      <ul className={styles.readings} aria-label="Latest values">
        {row.readings.map(({ metric: name, value }) => {
          const held = holds[name as keyof typeof holds];
          const hint = rulesFor(rules, device, name)[0];
          return (
            <li key={name} className={styles.reading}>
              <Icon glyph={metricIcons[metricIcon(name)]} size="sm" />
              <span className={styles.value}>
                {value === null ? '—' : formatValue(name, value)}
              </span>
              <span className={styles.unit}>{metricUnit(name)}</span>
              <span className={styles.metric}>
                {name}
                {hint ? ` · raise ${hint.raise}` : ''}
              </span>
              {held !== undefined ? (
                <Chip tone="accent">{`held at ${formatValue(name, held)}`}</Chip>
              ) : null}
            </li>
          );
        })}
      </ul>

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
        {...(device.metrics.length > 1
          ? { role: 'tabpanel', 'aria-labelledby': tabId(uid, metric) }
          : {})}
      >
        {metric ? (
          <LineChart
            deviceId={device.id}
            metric={metric}
            samples={series}
            now={now}
            rule={rule}
            status={{ kind: status.kind, since: status.since }}
            intervalMs={engineDevice?.intervalMs ?? 2000}
            height={150}
          />
        ) : null}
      </div>

      <footer className={styles.foot}>
        <span className={styles.meta}>
          seq {(engineDevice?.seq ?? 0).toLocaleString('en-US')} · {kindLabel(device.kind)}
        </span>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="outline"
            icon={uiIcons.pause}
            disabled={state !== 'running' || busy}
            aria-label={`Pause ${device.id}`}
            onClick={() => void commands.pause(device.id)}
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={uiIcons.play}
            disabled={state === 'running' || busy || lock.locked}
            aria-label={`Start ${device.id}`}
            onClick={() => void commands.start(device.id)}
          >
            Start
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={uiIcons.stop}
            disabled={state === 'stopped' || busy}
            aria-label={`Stop ${device.id}`}
            onClick={() => void commands.stop(device.id)}
          >
            Stop
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={uiIcons.inspect}
            aria-label={`Details of ${device.id}`}
            aria-haspopup="dialog"
            onClick={() => onOpen(device.id)}
          >
            Details
          </Button>
        </div>
      </footer>

      {error ? (
        <p className={styles.error} role="alert">
          <span>
            {device.id}: {error}
          </span>
          <Button size="sm" variant="ghost" onClick={() => commands.clearError(device.id)}>
            Dismiss
          </Button>
        </p>
      ) : null}
    </article>
  );
}

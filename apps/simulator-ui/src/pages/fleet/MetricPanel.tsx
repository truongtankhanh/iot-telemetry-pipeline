import { useId } from 'react';
import type { DeviceInfo, MetricProfile, RulesView } from '../../api/types';
import { metricUnit } from '../../lib/deviceIdentity';
import type { DeviceStatus } from '../../lib/deviceStatus';
import { formatValue, headroom, ruleSentence, rulesFor } from '../../lib/rules';
import { useSeries } from '../../state/historyContext';
import { LineChart } from '../../ui/charts/LineChart';
import { RangeBar } from '../../ui/charts/RangeBar';
import { Chip } from '../../ui/Chip';
import { toneIcons } from '../../ui/icons';
import { HoldControl } from './HoldControl';
import styles from './inspector.module.css';
import type { DeviceCommands } from './useDeviceCommands';

export interface MetricPanelProps {
  device: DeviceInfo;
  metric: string;
  rules: RulesView;
  profile: MetricProfile | null;
  now: number;
  status: DeviceStatus;
  intervalMs: number;
  /** The value held for this metric, or `null` when it is simulated. */
  held: number | null;
  /** The device is in hold mode: show the control. */
  holdMode: boolean;
  commands: DeviceCommands;
}

const amount = (n: number) => String(Math.round(n * 100) / 100);

/**
 * One metric of a device, as the inspector shows it (frame 02): the value and what state it is in against the rule,
 * the chart of the last two minutes at full width, the rule in words, the range bar, the baseline, noise and daily
 * swing the generator uses (read-only), and, in hold mode, the control to hold a value.
 */
export function MetricPanel({
  device,
  metric,
  rules,
  profile,
  now,
  status,
  intervalMs,
  held,
  holdMode,
  commands,
}: MetricPanelProps) {
  const headingId = useId();
  const series = useSeries(device.id, metric);
  const latest = series.at(-1)?.v ?? null;
  const rule = rulesFor(rules, device, metric)[0] ?? null;
  const unit = metricUnit(metric);
  const standing = rule && latest !== null ? headroom(rule, latest) : null;
  const busy = commands.isBusy(device.id);

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <header className={styles.panelHead}>
        <h3 id={headingId} className={styles.metricName}>
          {metric}
        </h3>
        {standing ? (
          standing.beyond ? (
            <Chip tone="warn" icon={toneIcons.warn}>
              Beyond raise
            </Chip>
          ) : (
            <Chip tone="ok" icon={toneIcons.ok}>
              Normal
            </Chip>
          )
        ) : null}
        <span className={styles.big}>
          {latest === null ? '—' : formatValue(metric, latest)}
          {unit ? <span className={styles.bigUnit}> {unit}</span> : null}
        </span>
      </header>

      <p className={styles.rule}>
        {rule ? (
          <>
            {ruleSentence(rule)}
            {standing ? ` · now ${standing.text}` : ''}
          </>
        ) : rules.available ? (
          'No rule watches this metric.'
        ) : (
          `Rules are not available: ${rules.reason ?? 'unknown reason'}.`
        )}
      </p>

      <LineChart
        deviceId={device.id}
        metric={metric}
        samples={series}
        now={now}
        rule={rule}
        status={{ kind: status.kind, since: status.since }}
        intervalMs={intervalMs}
        height={170}
      />

      {rule ? <RangeBar metric={metric} rule={rule} profile={profile} value={latest} /> : null}

      {profile ? (
        <dl className={styles.profile}>
          <div>
            <dt>Baseline</dt>
            <dd>
              {amount(profile.baseline)} {unit}
            </dd>
          </div>
          <div>
            <dt>Noise ±</dt>
            <dd>
              {amount(profile.noise)} {unit}
            </dd>
          </div>
          <div>
            <dt>Daily swing</dt>
            <dd>
              {amount(profile.dailySwing)} {unit}
            </dd>
          </div>
        </dl>
      ) : null}

      {holdMode ? (
        <HoldControl
          key={`${metric}-${held ?? 'none'}`}
          metric={metric}
          held={held}
          busy={busy}
          onHold={(value) => void commands.hold(device.id, metric, value)}
          onRelease={() => void commands.release(device.id, metric)}
        />
      ) : null}
    </section>
  );
}

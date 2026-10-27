import { telemetryTopic } from '@itp/telemetry-contract';
import { Link } from 'react-router';
import { metricLabel, metricUnit } from '../../lib/deviceIdentity';
import { formatValue, headroom, ruleSentence, rulesFor } from '../../lib/rules';
import { formatAgo } from '../../lib/time';
import { deviceTopologyState, TOPOLOGY_TONES } from '../../lib/topologyState';
import { useSeries } from '../../state/historyContext';
import { useStudio } from '../../state/studioContext';
import { LineChart } from '../../ui/charts/LineChart';
import { Chip } from '../../ui/Chip';
import { toneIcons } from '../../ui/icons';
import pagesStyles from '../pages.module.css';
import { Facts } from './TwinFacts';
import styles from './twin.module.css';
import type { TwinModel } from './useTwinModel';

export interface TwinInspectorProps {
  /** The device's id. Call it with `key={id}`, so the chart starts again for another device. */
  id: string;
  model: TwinModel;
}

/**
 * The device inspector (frame 15, the right-hand card): who the device is and the state it is in, the value of its main
 * metric and where that stands against the rule (the thresholds: raise, clear, how many readings in a row), the last two
 * minutes of it as a chart with the rule's lines, its other values, the topic it publishes on and whether its position is
 * a guess. It composes what the Fleet and the Topology already compose (`rulesFor`, `headroom`, `ruleSentence`,
 * `LineChart`, `useSeries`), so a number here is the one there. The main metric is the first the device has a rule for, else
 * its first. With no rule the card says so, and says why when the rules are not available at all.
 *
 * "Inject here" is not here: it is SIM-21. The state is a word and an icon as well as a colour, and a value beyond its raise
 * line says so in words ("2.3 °C above raise").
 */
export function TwinInspector({ id, model }: TwinInspectorProps) {
  const view = useStudio((state) => state.view);
  const pin = model.pins.find((candidate) => candidate.id === id);
  const row = model.list.find((candidate) => candidate.id === id);
  const fleet = model.rows.find((candidate) => candidate.device.id === id);

  const rules = view?.rules ?? null;
  const metrics: readonly string[] = fleet?.device.metrics ?? [];
  const metric =
    (fleet !== undefined && rules !== null
      ? metrics.find((name) => rulesFor(rules, fleet.device, name).length > 0)
      : undefined) ??
    metrics[0] ??
    '';
  const series = useSeries(id, metric);

  if (row === undefined || fleet === undefined || view === null || rules === null) return null;

  const latest =
    series.at(-1)?.v ?? fleet.readings.find((reading) => reading.metric === metric)?.value ?? null;
  const rule = rulesFor(rules, fleet.device, metric)[0] ?? null;
  const standing = rule !== null && latest !== null ? headroom(rule, latest) : null;
  const unit = metricUnit(metric);
  const intervalMs =
    view.engine.devices.find((device) => device.id === id)?.intervalMs ?? view.config.intervalMs;
  const tone = TOPOLOGY_TONES[pin?.state ?? deviceTopologyState(fleet.status.kind)];

  return (
    <>
      <div className={styles.inspectorHead}>
        <h3 className={styles.selectionTitle}>{row.name}</h3>
        <Chip tone={tone === 'unknown' ? 'neutral' : tone} icon={toneIcons[tone]}>
          {row.stateWord}
        </Chip>
      </div>

      {metric === '' ? (
        <p className={styles.hint}>This device reports no metric.</p>
      ) : (
        <section aria-label={`${metricLabel(metric)} of ${row.name}`}>
          <p className={styles.reading}>
            <span className={styles.big}>
              {latest === null ? '—' : formatValue(metric, latest)}
            </span>
            {unit ? <span className={styles.unit}>{unit}</span> : null}
            <span className={styles.metricName}>{metricLabel(metric)}</span>
          </p>
          <p className={styles.rule}>
            {rule !== null ? (
              <>
                {ruleSentence(rule)}
                {standing !== null ? ` · now ${standing.text}` : ''}
              </>
            ) : rules.available ? (
              'No rule watches this metric.'
            ) : (
              `Rules are not available: ${rules.reason ?? 'unknown reason'}.`
            )}
          </p>
          <LineChart
            deviceId={id}
            metric={metric}
            samples={series}
            now={model.now}
            rule={rule}
            status={{ kind: fleet.status.kind, since: fleet.status.since }}
            intervalMs={intervalMs}
            height={150}
          />
        </section>
      )}

      <Facts
        rows={[
          ['Id', row.id],
          ['Kind', row.kindLabel],
          ['Building', `${row.zoneName} (${row.zone})`],
          ['State', row.reason === null ? row.stateWord : `${row.stateWord}: ${row.reason}`],
          ...(row.alert === null ? [] : [['Alert', row.alert] as const]),
          ...row.readings
            .filter((reading) => reading.metric !== metric)
            .map((reading) => [reading.label, reading.text] as const),
          ['Last heard', row.lastSeen === null ? '—' : formatAgo(row.lastSeen, model.now)],
          ['Topic', telemetryTopic({ zoneCode: fleet.device.zoneCode, deviceId: id })],
          [
            'Position',
            pin === undefined
              ? `Not drawn: ${row.notPlacedReason ?? 'no position in the layout'}`
              : pin.placement === 'illustrative'
                ? 'Illustrative (placed by hand)'
                : 'Surveyed',
          ],
        ]}
      />
      <p>
        <Link className={pagesStyles.link} to={`/fleet?device=${encodeURIComponent(id)}`}>
          Open in Fleet
        </Link>
        {row.alert === null ? null : (
          <>
            {' · '}
            <Link className={pagesStyles.link} to="/alerts">
              Open alerts
            </Link>
          </>
        )}
      </p>
    </>
  );
}

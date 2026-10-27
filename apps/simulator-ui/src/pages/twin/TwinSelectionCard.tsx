import { Link } from 'react-router';
import type { ObservedAlert } from '../../api/types';
import { formatAgo } from '../../lib/time';
import { openAlertsWords } from '../../lib/twinAlerts';
import type { TwinPin } from '../../lib/twinPins';
import type { TwinSelection } from '../../lib/twinQuery';
import { useStudio } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import pagesStyles from '../pages.module.css';
import styles from './twin.module.css';
import type { TwinModel } from './useTwinModel';

const NO_ALERTS: readonly ObservedAlert[] = [];

function Facts({ rows }: { rows: [label: string, value: string][] }) {
  return (
    <dl className={styles.facts}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DeviceFacts({ id, model }: { id: string; model: TwinModel }) {
  const pin: TwinPin | undefined = model.pins.find((candidate) => candidate.id === id);
  const row = model.list.find((candidate) => candidate.id === id);
  if (row === undefined) return null;
  return (
    <>
      <h3 className={styles.selectionTitle}>{row.name}</h3>
      <Facts
        rows={[
          ['Id', row.id],
          ['Kind', row.kindLabel],
          ['Building', `${row.zoneName} (${row.zone})`],
          ['State', row.reason === null ? row.stateWord : `${row.stateWord}: ${row.reason}`],
          ...(row.alert === null ? [] : [['Alert', row.alert] as [string, string]]),
          ...row.readings.map((reading): [string, string] => [reading.label, reading.text]),
          ['Last heard', row.lastSeen === null ? '—' : formatAgo(row.lastSeen, model.now)],
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

function BuildingFacts({
  code,
  model,
  onSelect,
}: {
  code: string;
  model: TwinModel;
  onSelect: (target: TwinSelection) => void;
}) {
  const alerts = useStudio((state) => state.view?.alerts.alerts) ?? NO_ALERTS;
  const zone = model.layout.zones.find((candidate) => candidate.code === code);
  if (zone === undefined) return null;
  const inside = model.pins.filter((pin) => pin.zone === code);
  const assets = model.layout.catalogue.filter((asset) => asset.zone === code).length;
  return (
    <>
      <h3 className={styles.selectionTitle}>{zone.name}</h3>
      <Facts
        rows={[
          ['Building', code],
          ...(zone.use === undefined ? [] : [['Use', zone.use] as [string, string]]),
          ...(zone.heightM === undefined
            ? []
            : [['Height', `${zone.heightM} m`] as [string, string]]),
          ['Devices', inside.length === 0 ? 'none placed' : String(inside.length)],
          ['Catalogue assets', assets === 0 ? 'none' : `${assets} · not simulated`],
          ['Open alerts', openAlertsWords(alerts, new Set(inside.map((pin) => pin.id)))],
        ]}
      />
      {inside.length === 0 ? null : (
        <ul className={styles.deviceChoices} aria-label={`Devices in ${zone.name}`}>
          {inside.map((pin) => (
            <li key={pin.id}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelect({ type: 'device', id: pin.id })}
              >
                {pin.name}
              </Button>
              <span>{pin.reason === null ? pin.word : `${pin.word}: ${pin.reason}`}</span>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link className={pagesStyles.link} to="/alerts">
          Open alerts
        </Link>
      </p>
    </>
  );
}

export interface TwinSelectionCardProps {
  selection: TwinSelection | null;
  model: TwinModel;
  onSelect: (target: TwinSelection) => void;
}

/**
 * What the twin says about what is chosen (frame 14's right-hand card, read-only until SIM-20 and SIM-21 add focus and
 * injection): a building's facts and the devices in it, or a device's kind, state, values and position — the same words
 * and values as Fleet. A selection in the address that cannot be shown (an unknown device, a zone that is not a building)
 * is told in a sentence instead of being ignored.
 */
export function TwinSelectionCard({ selection, model, onSelect }: TwinSelectionCardProps) {
  return (
    <Card title="Selection">
      {model.notice === null ? null : (
        <p role="status" className={styles.notice}>
          {model.notice}
        </p>
      )}
      {selection === null ? (
        <p className={styles.hint}>
          Choose a building or a device in the scene, or a row in the list of devices.
        </p>
      ) : selection.type === 'device' ? (
        <DeviceFacts id={selection.id} model={model} />
      ) : (
        <BuildingFacts code={selection.id} model={model} onSelect={onSelect} />
      )}
      {selection === null ? null : (
        <p className={styles.hint}>Esc goes up one level; Home returns to the campus.</p>
      )}
    </Card>
  );
}

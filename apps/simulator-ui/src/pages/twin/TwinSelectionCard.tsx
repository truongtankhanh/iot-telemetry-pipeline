import { Link } from 'react-router';
import type { ObservedAlert } from '../../api/types';
import { openAlertsWords } from '../../lib/twinAlerts';
import type { TwinSelection } from '../../lib/twinQuery';
import { useStudio } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import pagesStyles from '../pages.module.css';
import { Facts } from './TwinFacts';
import { TwinInspector } from './TwinInspector';
import styles from './twin.module.css';
import type { TwinModel } from './useTwinModel';

const NO_ALERTS: readonly ObservedAlert[] = [];

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
          ...(model.heat === null || model.heat.id !== code
            ? []
            : [['Floor', model.heat.words] as const]),
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
 * What the twin says about what is chosen (frame 14's right-hand card, read-only until SIM-21 adds injection): a
 * building's facts and the devices in it, or, for a device, the inspector (`TwinInspector`: its value against the rule's
 * thresholds, its chart, its kind, state and position) — the same words and values as Fleet. A selection in the address
 * that cannot be shown (an unknown device, a zone that is not a building) is told in a sentence instead of being ignored.
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
        <TwinInspector key={selection.id} id={selection.id} model={model} />
      ) : (
        <BuildingFacts code={selection.id} model={model} onSelect={onSelect} />
      )}
      {selection === null ? null : (
        <p className={styles.hint}>Esc goes up one level; Home returns to the campus.</p>
      )}
    </Card>
  );
}

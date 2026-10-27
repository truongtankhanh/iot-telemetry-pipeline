import type { ViewLevel } from '../../lib/twinQuery';
import styles from './twin.module.css';
import type { TwinFocus, TwinModel } from './useTwinModel';

export interface TwinFocusTextProps {
  level: ViewLevel;
  /** The building in focus; nothing is drawn without one. */
  focus: TwinFocus | null;
  model: TwinModel;
}

/**
 * The text twin of the building in focus (SIM-20, D6): which level the viewer is on and how to go up, the devices in the
 * building with their values and state, what its floor says (interpolated, or no temperature data) and the sensors behind
 * it, and what else the catalogue puts there, so that with the scene hidden nothing about
 * the inside of a building is discoverable only in 3D. It is the device list's sibling and is hidden the same way.
 */
export function TwinFocusText({ level, focus, model }: TwinFocusTextProps) {
  if (focus === null) return null;
  const inside = model.list.filter((row) => row.zone === focus.code);
  return (
    <section className={styles.devices} aria-label={`${focus.zone.name}, as text`}>
      <h3>Inside {focus.zone.name}</h3>
      <p>
        {level === 'device'
          ? `A device in ${focus.zone.name} is chosen. Escape goes up to the building, and again to the campus.`
          : `${focus.zone.name} is in focus: its walls are see-through and the rest of the campus is faded. Escape returns to the campus.`}
      </p>
      {inside.length === 0 ? (
        <p>No simulated device is placed in this building.</p>
      ) : (
        <ul aria-label={`Devices in ${focus.zone.name}`}>
          {inside.map((row) => (
            <li key={row.id}>
              {row.name}: {row.reason === null ? row.stateWord : `${row.stateWord}, ${row.reason}`}
              {row.readings.length === 0
                ? ''
                : `; ${row.readings.map((reading) => `${reading.label} ${reading.text}`).join(', ')}`}
            </li>
          ))}
        </ul>
      )}
      {model.heat === null ? null : (
        <>
          <p>{model.heat.words}</p>
          {model.heat.sensors.length === 0 ? null : (
            <ul aria-label="Sensors behind the floor">
              {model.heat.sensors.map((sensor) => (
                <li key={sensor.id}>
                  {sensor.name}: {sensor.celsius.toFixed(1)} °C
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {focus.groups.length === 0 ? (
        <p>No asset of the command center&apos;s catalogue stands in this building.</p>
      ) : (
        <ul aria-label="Catalogue assets, not simulated">
          {focus.groups.map((group) => (
            <li key={group.class}>
              {group.codes.join(', ')}: {group.label}
              {group.where === null ? '' : `, ${group.where}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

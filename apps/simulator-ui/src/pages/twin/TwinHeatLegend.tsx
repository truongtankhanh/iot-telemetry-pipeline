import { HEAT_MAX_C, HEAT_MIN_C, type HeatModel } from '../../lib/twinHeat';
import styles from './twinStage.module.css';

export interface TwinHeatLegendProps {
  /** The floor of the building in focus, or `null` at campus level (there is no floor to read). */
  heat: HeatModel | null;
}

/**
 * The key to the heat floor (frame 15), a card over the stage's bottom left while the Heat layer is on: the ramp as a
 * continuous gradient over the six stops, its two ends in degrees (a temperature beyond them is coloured at the end and keeps
 * its real number), and **the sentence that says what the floor is** — interpolated between N sensors, not measured; or, for a
 * floor with nothing to interpolate, that there is no temperature data or no recent one, beside the hatch that draws it. At
 * campus level it says to focus a building. It is text first (a colour never says it alone) and lets the pointer through,
 * so it never blocks the camera.
 */
export function TwinHeatLegend({ heat }: TwinHeatLegendProps) {
  const hatched = heat !== null && heat.colors.length === 0;
  return (
    <section className={styles.heatLegend} aria-label="Heat legend">
      <h3 className={styles.heatTitle}>Indoor temperature</h3>
      {heat === null ? (
        <p className={styles.heatText}>Focus a building to see its floor.</p>
      ) : (
        <>
          {hatched ? null : (
            <>
              <div
                className={styles.heatRamp}
                role="img"
                aria-label={`Colour scale from ${HEAT_MIN_C} °C to ${HEAT_MAX_C} °C`}
              />
              <div className={styles.heatEnds}>
                <span>{HEAT_MIN_C} °C</span>
                <span>{HEAT_MAX_C} °C</span>
              </div>
            </>
          )}
          <p className={styles.heatText}>
            {hatched ? <i className={styles.heatHatch} aria-hidden="true" /> : null}
            {heat.words}
          </p>
          {hatched ? null : (
            <p className={styles.heatText}>
              Beyond the ends the floor takes the end colour; the number stays the real one.
            </p>
          )}
        </>
      )}
    </section>
  );
}

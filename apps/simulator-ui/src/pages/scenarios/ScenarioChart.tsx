import { useId, useMemo } from 'react';
import type { DeviceInfo, RulesView, ScenarioItem } from '../../api/types';
import {
  buildScenarioChart,
  type ChartAxis,
  type ChartTick,
  playheadOf,
} from '../../lib/scenarioChart';
import { chartDescription } from '../../lib/scenarioExpectation';
import { useElementWidth } from '../../ui/charts/useElementWidth';
import { LaneChart } from './LaneChart';
import styles from './scenarioChart.module.css';
import { useRunElapsed } from './useRunElapsed';
import { ValueChart } from './ValueChart';

const PILL_WIDTH = 52;
const PILL_HEIGHT = 18;
/** The width before the picture's own width is known, and in a test, which has no `ResizeObserver`. */
const FALLBACK_WIDTH = 330;

/** The time axis: a faint line at each numbered second, short ticks between, and the numbers. */
function TimeAxis({ axis, ticks }: { axis: ChartAxis; ticks: readonly ChartTick[] }) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) =>
        tick.label === null ? (
          <line
            key={tick.x}
            className={styles.gridMinor}
            x1={tick.x}
            x2={tick.x}
            y1={axis.bottom - 4}
            y2={axis.bottom}
          />
        ) : (
          <g key={tick.x}>
            <line
              className={styles.gridMajor}
              x1={tick.x}
              x2={tick.x}
              y1={axis.top}
              y2={axis.bottom}
            />
            <text
              className={styles.tickLabel}
              x={tick.x}
              y={axis.bottom + 16}
              textAnchor={tick.anchor}
            >
              {tick.label}
            </text>
          </g>
        ),
      )}
      <line
        className={styles.baseline}
        x1={axis.left}
        x2={axis.right}
        y1={axis.bottom}
        y2={axis.bottom}
      />
    </g>
  );
}

/**
 * Where a running scenario has got to: the part already played tinted, a line, and a pill with the second. Drawn only
 * while the scenario plays, because it owns the one-second timer that moves it (`useRunElapsed`), so a card that is not
 * running has none. A static line: nothing moves by itself, so there is nothing to switch off for reduced motion.
 */
function Playhead({
  scenario,
  lengthS,
  axis,
  width,
}: {
  scenario: string;
  lengthS: number;
  axis: ChartAxis;
  width: number;
}) {
  const elapsed = useRunElapsed(scenario, lengthS);
  if (elapsed === null) return null;
  const head = playheadOf(axis, elapsed);
  const pillX = Math.min(Math.max(head.x - PILL_WIDTH / 2, 0), width - PILL_WIDTH);
  return (
    <g data-part="playhead" aria-hidden="true">
      <rect
        className={styles.played}
        x={axis.left}
        y={axis.top}
        width={head.playedWidth}
        height={axis.bottom - axis.top}
      />
      <line
        className={styles.playheadLine}
        x1={head.x}
        x2={head.x}
        y1={axis.top}
        y2={axis.bottom}
      />
      <rect
        className={styles.pill}
        x={pillX}
        y={axis.bottom + 4}
        width={PILL_WIDTH}
        height={PILL_HEIGHT}
        rx={5}
      />
      <text
        className={styles.pillText}
        x={pillX + PILL_WIDTH / 2}
        y={axis.bottom + 4 + 13}
        textAnchor="middle"
      >
        {head.label}
      </text>
    </g>
  );
}

export interface ScenarioChartProps {
  item: ScenarioItem;
  rules: RulesView;
  devices: readonly DeviceInfo[];
  /** The scenario is playing: the playhead is drawn. */
  running: boolean;
}

/**
 * The chart of a scenario card (frame 03), drawn at its true pixel width so that its text stays 13 px or more: the value
 * against the rule's raise and clear lines with the alert and the clear as flags for a scenario on one signal, one lane
 * for each device for a scenario on several. The picture is a `role="img"` whose name is a sentence with the numbers in
 * it; the card says the same in text beside it. When the simulator could not work out the expected alerts there is
 * nothing honest to draw, and the figure stays empty: the card says why in words.
 */
export function ScenarioChart({ item, rules, devices, running }: ScenarioChartProps) {
  const [ref, width] = useElementWidth<HTMLElement>(FALLBACK_WIDTH);
  const uid = useId().replace(/:/g, '');
  const model = useMemo(
    () => buildScenarioChart({ item, rules, devices, width }),
    [item, rules, devices, width],
  );

  return (
    <figure className={styles.figure} ref={ref}>
      {model === null ? null : (
        <svg
          className={styles.chart}
          width={model.width}
          height={model.height}
          viewBox={`0 0 ${model.width} ${model.height}`}
          role="img"
          aria-label={chartDescription(item, null)}
          data-kind={model.kind}
        >
          <TimeAxis axis={model.axis} ticks={model.xTicks} />
          {model.kind === 'value' ? (
            <ValueChart model={model} uid={uid} />
          ) : (
            <LaneChart model={model} />
          )}
          {running ? (
            <Playhead
              scenario={item.name}
              lengthS={item.lengthS}
              axis={model.axis}
              width={model.width}
            />
          ) : null}
        </svg>
      )}
    </figure>
  );
}

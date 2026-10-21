import {
  type ChartBlock,
  type ChartLane,
  LANE_HEIGHT,
  type LaneChartModel,
} from '../../lib/scenarioChart';
import type { DeviceShape } from '../../lib/deviceIdentity';
import styles from './scenarioChart.module.css';

const MARK_X = 14;
const BLOCK_INSET = 3;
const BLOCK_HEIGHT = 20;

/** The shape of the device's kind beside its lane: identity is a shape and a code, never a colour. */
function LaneMark({ shape, y }: { shape: DeviceShape; y: number }) {
  const cx = MARK_X;
  const cy = y + LANE_HEIGHT / 2;
  switch (shape) {
    case 'circle':
      return <circle className={styles.mark} cx={cx} cy={cy} r={6.5} />;
    case 'hexagon':
      return (
        <polygon
          className={styles.mark}
          points={`${cx - 5.5},${cy} ${cx - 2.75},${cy - 6} ${cx + 2.75},${cy - 6} ${cx + 5.5},${cy} ${cx + 2.75},${cy + 6} ${cx - 2.75},${cy + 6}`}
        />
      );
    case 'rounded-square':
      return <rect className={styles.mark} x={cx - 6} y={cy - 6} width={12} height={12} rx={3} />;
    case 'rounded':
      return <rect className={styles.mark} x={cx - 6} y={cy - 6} width={12} height={12} rx={6} />;
  }
}

/** One anomaly as a block: a rectangle for a step, a rising wedge for a ramp, a peak for a spike. */
function Block({ block, y }: { block: ChartBlock; y: number }) {
  const top = y + BLOCK_INSET;
  const bottom = top + BLOCK_HEIGHT;
  const { x, width } = block;
  return (
    <g className={styles.block} data-shape={block.shape}>
      <title>{block.title}</title>
      {block.shape === 'step' ? (
        <rect x={x} y={top} width={width} height={BLOCK_HEIGHT} rx={4} />
      ) : (
        <polygon
          points={
            block.shape === 'ramp'
              ? `${x},${bottom} ${x + width},${bottom} ${x + width},${top}`
              : `${x},${bottom} ${x + width / 2},${top} ${x + width},${bottom}`
          }
        />
      )}
      {block.label === null || block.shape !== 'step' ? null : (
        <text className={styles.blockLabel} x={x + 6} y={top + 14}>
          {block.label}
        </text>
      )}
    </g>
  );
}

/** The alert as a dot where it opens, a line to the dot where it clears; with no clear known, a dashed line to the edge. */
function AlertRun({ lane, right }: { lane: ChartLane; right: number }) {
  const y = lane.y + LANE_HEIGHT - 2;
  return (
    <>
      {lane.alerts.map((alert) => (
        <g
          key={alert.openX}
          className={styles.alertRun}
          data-severity={alert.severity}
          data-uncertain={alert.uncertain ? 'true' : undefined}
          data-open={alert.clearX === null ? 'true' : undefined}
        >
          <title>
            {alert.clearX === null
              ? `${alert.title}: no clear known`
              : alert.uncertain
                ? `${alert.title}: clears later than shown, perhaps`
                : alert.title}
          </title>
          <line
            className={styles.runLine}
            x1={alert.openX}
            x2={alert.clearX ?? right}
            y1={y}
            y2={y}
          />
          <circle className={styles.alertDot} cx={alert.openX} cy={y} r={3.2} />
          {alert.clearX === null ? null : (
            <circle className={styles.clearDot} cx={alert.clearX} cy={y} r={3.2} />
          )}
        </g>
      ))}
    </>
  );
}

/**
 * A scenario that moves several signals: one lane for each device, with its shape and code, a block for each anomaly with
 * its value inside, and the alert and the clear on the lane that raises them. What does not fit is one line of text.
 */
export function LaneChart({ model }: { model: LaneChartModel }) {
  const { axis } = model;
  return (
    <>
      {model.lanes.map((lane, row) => (
        <g key={lane.key} className={styles.lane} data-part="lane">
          <title>{lane.label}</title>
          <rect
            className={styles.laneBand}
            data-odd={row % 2 === 1 ? 'true' : undefined}
            x={4}
            y={lane.y}
            width={model.width - 8}
            height={LANE_HEIGHT}
            rx={5}
          />
          <LaneMark shape={lane.shape} y={lane.y} />
          <text className={styles.laneCode} x={MARK_X + 12} y={lane.y + 17}>
            {lane.code}
          </text>
          {lane.blocks.map((block) => (
            <Block key={block.x} block={block} y={lane.y} />
          ))}
          <AlertRun lane={lane} right={axis.right} />
        </g>
      ))}
      {model.more === null ? null : (
        <text className={styles.more} x={axis.left} y={model.more.y + 14}>
          {model.more.text}
        </text>
      )}
    </>
  );
}

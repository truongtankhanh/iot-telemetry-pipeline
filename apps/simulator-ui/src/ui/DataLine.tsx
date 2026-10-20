import { useAnimationSlot } from './animationBudgetContext';
import styles from './status.module.css';

export interface DataLineProps {
  from: readonly [number, number];
  to: readonly [number, number];
  /** True while data is moving along it. A line that carries nothing is a dim dashed wire: no light. */
  flowing: boolean;
  width?: number;
  height?: number;
}

/**
 * A line in three layers (halo, glow, core) when it carries data. Light means energy is moving, so a
 * line that carries nothing has none; and at most 24 lines on a screen glow, the rest are drawn plain
 * (the budget decides, in the order lines were drawn).
 */
export function DataLine({ from, to, flowing, width = 120, height = 24 }: DataLineProps) {
  const glowing = useAnimationSlot('line', flowing);
  const points = { x1: from[0], y1: from[1], x2: to[0], y2: to[1] };
  return (
    <svg
      className={styles.line}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={flowing ? 'Data is moving' : 'No data moving'}
      data-flowing={flowing ? 'true' : 'false'}
      data-glowing={glowing ? 'true' : undefined}
    >
      <line data-layer="halo" {...points} />
      <line data-layer="glow" {...points} />
      <line data-layer="core" {...points} />
    </svg>
  );
}

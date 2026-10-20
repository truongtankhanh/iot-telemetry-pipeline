import { useMemo } from 'react';
import { sparkline, WINDOW_MS } from '../../lib/chartMath';
import type { Sample } from '../../state/history';
import styles from './charts.module.css';

export interface SparklineProps {
  samples: readonly Sample[];
  now: number;
  width?: number;
  height?: number;
  /** A sentence for a screen reader. Without one the picture is decoration: the row beside it carries the numbers. */
  label?: string;
}

/**
 * The last two minutes of a metric in a small box, scaled to its own min and max, for a table row. No glow: a
 * table of a hundred rows must not light up. It re-draws when its readings do (once a second at most).
 */
export function Sparkline({ samples, now, width = 72, height = 22, label }: SparklineProps) {
  const { d, last } = useMemo(
    () => sparkline(samples, now, { width, height, windowMs: WINDOW_MS }),
    [samples, now, width, height],
  );
  return (
    <svg
      className={styles.spark}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {d ? (
        <>
          <path d={d} />
          {last ? <circle cx={last.x} cy={last.y} r="2" /> : null}
        </>
      ) : (
        <line x1="2" x2={width - 2} y1={height / 2} y2={height / 2} data-empty="true" />
      )}
    </svg>
  );
}

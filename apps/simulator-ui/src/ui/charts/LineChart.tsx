import { useId, useMemo } from 'react';
import { buildLineChart, type LineChartInput } from '../../lib/chartMath';
import { useAnimationSlot } from '../animationBudgetContext';
import styles from './charts.module.css';
import { useElementWidth } from './useElementWidth';

export type LineChartProps = Omit<LineChartInput, 'width'>;

/**
 * The last two minutes of one metric of one device (frames 01 and 02): labelled axes, the rule's raise and clear
 * lines, the part of the line beyond the raise line in amber, the last value as a tag, min, average and max
 * beneath, and a hatched gap with its reason where the device paused, stopped or went silent. There is no
 * alert marker: the state is beside the device's name, as on Topology. The picture is a `role="img"` whose name
 * is a sentence with the numbers in it, and the figures beneath are text.
 */
export function LineChart(props: LineChartProps) {
  const { deviceId, metric, samples, now, rule, intervalMs, height, windowMs } = props;
  const statusKind = props.status.kind;
  const statusSince = props.status.since;
  const [ref, width] = useElementWidth<HTMLDivElement>(480);
  const uid = useId().replace(/:/g, '');
  const glowing = useAnimationSlot('line', samples.length > 0);

  const model = useMemo(
    () =>
      buildLineChart({
        deviceId,
        metric,
        samples,
        now,
        rule,
        status: { kind: statusKind, since: statusSince },
        intervalMs,
        width,
        ...(height === undefined ? {} : { height }),
        ...(windowMs === undefined ? {} : { windowMs }),
      }),
    [
      deviceId,
      metric,
      samples,
      now,
      rule,
      statusKind,
      statusSince,
      intervalMs,
      width,
      height,
      windowMs,
    ],
  );
  const { plot } = model;
  const plotWidth = plot.right - plot.left;

  return (
    <figure className={styles.figure} ref={ref}>
      <svg
        className={styles.chart}
        width={model.width}
        height={model.height}
        viewBox={`0 0 ${model.width} ${model.height}`}
        role="img"
        aria-label={model.description}
        data-glowing={glowing ? 'true' : undefined}
      >
        <defs>
          <pattern
            id={`hatch-${uid}`}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className={styles.hatch} />
          </pattern>
          <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className={styles.areaTop} />
            <stop offset="100%" className={styles.areaBottom} />
          </linearGradient>
          {model.breach ? (
            <clipPath id={`breach-${uid}`}>
              <rect
                x={plot.left}
                y={model.breach.y}
                width={plotWidth}
                height={model.breach.height}
              />
            </clipPath>
          ) : null}
        </defs>

        {model.yTicks.map((tick) => (
          <g key={tick.value}>
            <line className={styles.grid} x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} />
            <text className={styles.axis} x={plot.left - 6} y={tick.y + 4} textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}
        {model.xTicks.map((tick, i) => (
          <text
            key={tick.label}
            className={styles.axis}
            x={tick.x}
            y={plot.bottom + 17}
            textAnchor={i === 0 ? 'start' : i === model.xTicks.length - 1 ? 'end' : 'middle'}
          >
            {tick.label}
          </text>
        ))}

        {model.gaps.map((gap) => (
          <g key={`${gap.x}-${gap.width}`} data-gap="true">
            <rect
              className={styles.gap}
              x={gap.x}
              y={plot.top}
              width={gap.width}
              height={plot.bottom - plot.top}
              fill={`url(#hatch-${uid})`}
            />
            {gap.width > 96 ? (
              <text
                className={styles.gapText}
                x={gap.x + gap.width / 2}
                y={plot.top + 16}
                textAnchor="middle"
              >
                {gap.reason}
              </text>
            ) : null}
          </g>
        ))}

        {model.clear ? (
          <g>
            <line
              className={styles.clearLine}
              x1={plot.left}
              x2={plot.right}
              y1={model.clear.y}
              y2={model.clear.y}
            />
            <text className={styles.clearText} x={plot.right + 6} y={model.clear.y + 4}>
              {model.clear.label}
            </text>
          </g>
        ) : null}
        {model.raise ? (
          <g>
            <line
              className={styles.raiseLine}
              x1={plot.left}
              x2={plot.right}
              y1={model.raise.y}
              y2={model.raise.y}
            />
            <text className={styles.raiseText} x={plot.right + 6} y={model.raise.y + 4}>
              {model.raise.label}
            </text>
          </g>
        ) : null}

        {model.line ? (
          <>
            <path data-layer="area" d={model.area} fill={`url(#area-${uid})`} />
            {glowing ? <path data-layer="halo" className={styles.halo} d={model.line} /> : null}
            <path data-layer="line" className={styles.line} d={model.line} />
            {model.breach ? (
              <path
                data-layer="breach"
                className={styles.lineBreach}
                d={model.line}
                clipPath={`url(#breach-${uid})`}
              />
            ) : null}
          </>
        ) : null}

        {model.last ? (
          <g>
            <circle className={styles.dot} cx={model.last.x} cy={model.last.y} r="3.5" />
            <g
              transform={`translate(${model.last.x + 8}, ${model.last.y})`}
              data-beyond={model.raise?.beyond ? 'true' : undefined}
              className={styles.tag}
            >
              <rect x="0" y="-10" width={model.last.label.length * 8 + 10} height="20" rx="4" />
              <text x="5" y="4">
                {model.last.label}
              </text>
            </g>
          </g>
        ) : null}
      </svg>

      <figcaption className={styles.caption}>
        {model.stats ? (
          <>
            <span>
              min <b>{model.stats.min}</b>
            </span>
            <span>
              avg <b>{model.stats.avg}</b>
            </span>
            <span>
              max <b>{model.stats.max}</b>
            </span>
          </>
        ) : (
          <span>No readings in the last 2 min</span>
        )}
        {model.raise?.headroom ? (
          <span className={styles.headroom} data-beyond={model.raise.beyond ? 'true' : undefined}>
            {model.raise.headroom}
          </span>
        ) : null}
        {model.collecting ? <span className={styles.collecting}>{model.collecting}</span> : null}
      </figcaption>
    </figure>
  );
}

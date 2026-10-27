import { type ReactNode, useMemo } from 'react';
import { type AnalyticsChartInput, buildAnalyticsChart } from '../../lib/analyticsChart';
import { useAnimationSlot } from '../../ui/animationBudgetContext';
import chartStyles from '../../ui/charts/charts.module.css';
import { useElementWidth } from '../../ui/charts/useElementWidth';
import styles from './analytics.module.css';

/** The width before the picture's own width is known, and in a test, which has no `ResizeObserver`. */
const FALLBACK_WIDTH = 480;

export type SeriesChartProps = Omit<AnalyticsChartInput, 'width' | 'height'> & {
  height?: number;
  /** Under the picture, after the window: the figures the picture cannot say (the gap between the lines, a projected finish). */
  caption?: ReactNode;
};

/**
 * One or two lines over time (frame 09), drawn at the picture's true pixel width so its text stays 13 px or more. The geometry is
 * `lib/analyticsChart.ts`; this draws what it returns. The picture is a `role="img"` whose name is a sentence with the numbers in it, the
 * window of time is always written under it, and a second line is dashed as well as violet, so colour is never the only signal.
 *
 * `lines`, `formatY`, `formatX`, `bands`, `marks` and `average` are dependencies of the model: pass the same objects while their content is
 * the same (a `useMemo` in the caller, module-level functions), or the picture is worked out again on every render.
 */
export function SeriesChart({ height = 300, caption, ...input }: SeriesChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const { title, yUnit, window: windowText, lines, formatY, formatX } = input;
  const { yFloor, xDomain, bands, marks, average } = input;
  const model = useMemo(
    () =>
      buildAnalyticsChart({
        title,
        yUnit,
        window: windowText,
        lines,
        formatY,
        formatX,
        width,
        height,
        ...(yFloor === undefined ? {} : { yFloor }),
        ...(xDomain === undefined ? {} : { xDomain }),
        ...(bands === undefined ? {} : { bands }),
        ...(marks === undefined ? {} : { marks }),
        ...(average === undefined ? {} : { average }),
      }),
    [
      title,
      yUnit,
      windowText,
      lines,
      formatY,
      formatX,
      yFloor,
      xDomain,
      bands,
      marks,
      average,
      width,
      height,
    ],
  );
  const { plot } = model;
  const glowing = useAnimationSlot('line', !model.empty);

  return (
    <figure className={chartStyles.figure} ref={ref}>
      {model.lines.length > 1 ? (
        <ul className={styles.legend} aria-label="Lines of the chart">
          {model.lines.map((line) => (
            <li key={line.id}>
              <i
                className={styles.swatch}
                data-secondary={line.secondary ? 'true' : undefined}
                aria-hidden="true"
              />
              {line.label}
            </li>
          ))}
        </ul>
      ) : null}
      <svg
        className={chartStyles.chart}
        width={model.width}
        height={model.height}
        viewBox={`0 0 ${model.width} ${model.height}`}
        role="img"
        aria-label={model.description}
        data-glowing={glowing ? 'true' : undefined}
      >
        {model.bands.map((band, i) => (
          <g key={band.label}>
            <rect
              className={styles.band}
              data-alt={i % 2 === 1 ? 'true' : undefined}
              x={band.x}
              y={plot.top}
              width={band.width}
              height={plot.bottom - plot.top}
            />
            {band.showLabel ? (
              <text
                className={styles.bandLabel}
                x={band.x + band.width / 2}
                y={plot.top - 8}
                textAnchor="middle"
              >
                {band.label}
              </text>
            ) : null}
          </g>
        ))}

        {model.yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              className={chartStyles.grid}
              x1={plot.left}
              x2={plot.right}
              y1={tick.at}
              y2={tick.at}
            />
            <text className={chartStyles.axis} x={plot.left - 8} y={tick.at + 4} textAnchor="end">
              {tick.label}
            </text>
          </g>
        ))}
        {model.xTicks.map((tick, i) => (
          <text
            key={tick.value}
            className={chartStyles.axis}
            x={tick.at}
            y={plot.bottom + 18}
            textAnchor={i === 0 ? 'start' : i === model.xTicks.length - 1 ? 'end' : 'middle'}
          >
            {tick.label}
          </text>
        ))}
        <text className={chartStyles.axis} x={4} y={14}>
          {yUnit}
        </text>

        {model.marks.map((mark) => (
          <g key={mark.label}>
            <line className={styles.mark} x1={mark.x} x2={mark.x} y1={plot.top} y2={plot.bottom} />
            {mark.showLabel ? (
              <text className={styles.markLabel} x={mark.x + 6} y={plot.top + 14}>
                {mark.label}
              </text>
            ) : null}
          </g>
        ))}

        {model.average ? (
          <g>
            <line
              className={styles.average}
              x1={plot.left}
              x2={plot.right}
              y1={model.average.y}
              y2={model.average.y}
            />
            <text
              className={styles.averageLabel}
              x={plot.right}
              y={model.average.y - 6}
              textAnchor="end"
            >
              {model.average.label}
            </text>
          </g>
        ) : null}

        {model.empty ? (
          <text
            className={styles.emptyText}
            x={(plot.left + plot.right) / 2}
            y={(plot.top + plot.bottom) / 2}
            textAnchor="middle"
          >
            No data yet
          </text>
        ) : null}

        {model.lines.map((line, index) => (
          <g key={line.id} data-line={line.id}>
            {glowing && index === 0
              ? line.segments.map((points) => (
                  <polyline key={`halo-${points}`} className={chartStyles.halo} points={points} />
                ))
              : null}
            {line.segments.map((points) => (
              <polyline
                key={points}
                className={line.secondary ? styles.lineSecondary : chartStyles.line}
                data-secondary={line.secondary ? 'true' : undefined}
                points={points}
              />
            ))}
            {line.last ? (
              <circle
                className={line.secondary ? styles.dotSecondary : chartStyles.dot}
                cx={line.last.x}
                cy={line.last.y}
                r="3.5"
              />
            ) : null}
            {line.tag ? (
              <g
                className={styles.tag}
                data-tag={line.id}
                data-secondary={line.secondary ? 'true' : undefined}
              >
                <rect
                  x={line.tag.x}
                  y={line.tag.y}
                  width={line.tag.width}
                  height={line.tag.height}
                  rx="6"
                />
                <text
                  x={line.tag.x + line.tag.width / 2}
                  y={line.tag.y + line.tag.height / 2 + 5}
                  textAnchor="middle"
                >
                  {line.tag.text}
                </text>
              </g>
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption className={chartStyles.caption}>
        <span>{windowText.charAt(0).toUpperCase() + windowText.slice(1)}.</span>
        {caption}
      </figcaption>
    </figure>
  );
}

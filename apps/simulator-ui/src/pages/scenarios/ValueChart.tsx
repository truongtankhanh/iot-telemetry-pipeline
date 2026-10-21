import type { ChartFlag, ValueChartModel } from '../../lib/scenarioChart';
import styles from './scenarioChart.module.css';

const DOT_RADIUS = 4.5;

/** An alert or a clear: a dot on the top edge, a dashed line down to the axis, and the words beside it when there is room. */
function Flag({ flag, bottom }: { flag: ChartFlag; bottom: number }) {
  return (
    <g
      className={styles.flag}
      data-kind={flag.kind}
      data-severity={flag.severity}
      data-uncertain={flag.uncertain ? 'true' : undefined}
    >
      <title>{flag.uncertain ? `${flag.text} or later` : flag.text}</title>
      <line className={styles.flagLine} x1={flag.x} x2={flag.x} y1={flag.y} y2={bottom} />
      <circle className={styles.flagDot} cx={flag.x} cy={flag.y} r={DOT_RADIUS} />
      {flag.label === null ? null : (
        <text
          className={styles.flagLabel}
          x={flag.labelX}
          y={flag.y + 4}
          textAnchor={flag.labelAnchor}
        >
          {flag.label}
        </text>
      )}
    </g>
  );
}

/**
 * The value of a one-signal scenario against its rule: the line with the soft area under it, the part beyond the raise
 * line in amber, the raise and clear lines with their numbers, the extreme value as a tag, and the alert and the clear as
 * flags. Everything it draws comes from the model; it works out nothing.
 */
export function ValueChart({ model, uid }: { model: ValueChartModel; uid: string }) {
  const { axis } = model;
  const gradient = `${uid}-area`;
  const clip = `${uid}-breach`;
  return (
    <>
      <defs>
        <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" className={styles.areaTop} />
          <stop offset="1" className={styles.areaBottom} />
        </linearGradient>
        {model.breach === null ? null : (
          <clipPath id={clip}>
            <rect
              x={axis.left}
              y={model.breach.y}
              width={axis.right - axis.left}
              height={model.breach.height}
            />
          </clipPath>
        )}
      </defs>
      {model.area === '' ? null : (
        <path className={styles.area} d={model.area} fill={`url(#${gradient})`} />
      )}
      {model.clear === null ? null : (
        <g data-part="clear-line">
          <line
            className={styles.clearLine}
            x1={axis.left}
            x2={axis.right}
            y1={model.clear.y}
            y2={model.clear.y}
          />
          <text className={styles.ruleLabel} x={axis.right} y={model.clear.y + 14} textAnchor="end">
            {model.clear.label}
          </text>
        </g>
      )}
      {model.raise === null ? null : (
        <g data-part="raise-line">
          <line
            className={styles.raiseLine}
            x1={axis.left}
            x2={axis.right}
            y1={model.raise.y}
            y2={model.raise.y}
          />
          <text className={styles.ruleLabel} x={axis.right} y={model.raise.y - 4} textAnchor="end">
            {model.raise.label}
          </text>
        </g>
      )}
      {model.line === '' ? null : <path className={styles.series} d={model.line} />}
      {model.line === '' || model.breach === null ? null : (
        <path className={styles.seriesBreach} d={model.line} clipPath={`url(#${clip})`} />
      )}
      {model.tag === null ? null : (
        <text className={styles.tag} x={model.tag.x} y={model.tag.y} textAnchor="middle">
          {model.tag.label}
        </text>
      )}
      {model.flags.map((flag) => (
        <Flag key={`${flag.kind}-${flag.x}`} flag={flag} bottom={axis.bottom} />
      ))}
    </>
  );
}

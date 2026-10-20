import { useMemo } from 'react';
import type { MetricProfile, RuleInfo } from '../../api/types';
import { rangeBarModel } from '../../lib/chartMath';
import { formatAmount } from '../../lib/rules';
import { metricUnit } from '../../lib/deviceIdentity';
import styles from './charts.module.css';

export interface RangeBarProps {
  metric: string;
  rule: RuleInfo;
  profile: MetricProfile | null;
  value: number | null;
}

/**
 * The scale of a metric split into the safe zone, the hysteresis band between the clear and raise lines (hatched)
 * and the alarm zone, with the baseline and a pin at the current value (frame 02). The pin is a shape and a label,
 * not a colour: it is named in text beside it. A screen reader gets one sentence for the whole bar.
 */
export function RangeBar({ metric, rule, profile, value }: RangeBarProps) {
  const model = useMemo(
    () => rangeBarModel({ metric, rule, profile, value }),
    [metric, rule, profile, value],
  );
  const unit = metricUnit(metric);
  const label = (n: number) => (unit ? `${formatAmount(n)} ${unit}` : formatAmount(n));
  const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

  return (
    <div className={styles.rangebar} role="img" aria-label={model.text}>
      <div className={styles.inner}>
        <div className={styles.track}>
          {model.zones.map((zone) => (
            <span
              key={zone.kind}
              className={styles.zone}
              data-kind={zone.kind}
              style={{ left: pct(zone.from), width: pct(zone.to - zone.from) }}
            />
          ))}
          {model.baseline !== null ? (
            <span
              className={styles.baseline}
              style={{ left: pct(model.baseline) }}
              data-pin="baseline"
            />
          ) : null}
          {model.value !== null ? (
            <span
              className={styles.pin}
              style={{ left: pct(model.value) }}
              data-pin="value"
              data-off-scale={model.offScale ? 'true' : undefined}
            />
          ) : null}
        </div>
        <div className={styles.legend} aria-hidden="true">
          {model.baseline !== null && profile ? (
            <span style={{ left: pct(model.baseline) }} data-row="low">
              baseline {label(profile.baseline)}
            </span>
          ) : null}
          {model.value !== null && value !== null ? (
            <span style={{ left: pct(model.value) }} data-row="above" data-emphasis="true">
              now {label(value)}
            </span>
          ) : null}
          <span style={{ left: pct(model.clearAt) }}>clear {label(rule.clear)}</span>
          <span style={{ left: pct(model.raiseAt) }}>raise {label(rule.raise)}</span>
        </div>
      </div>
    </div>
  );
}

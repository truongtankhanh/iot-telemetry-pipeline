import type { ObservedAlert, RulesView } from '../../api/types';
import { alertTrail } from '../../lib/alertTrail';
import { ruleOf } from '../../lib/alertWhy';
import { useSeries } from '../../state/historyContext';
import { useStudio } from '../../state/studioContext';
import { AlertTrail } from '../alerts/AlertTrail';
import styles from './inspector.module.css';

export interface LabTraceProps {
  deviceId: string | null;
  /** The newest alert on the device, or `null`. */
  alert: ObservedAlert | null;
}

const NO_RULES: RulesView = { available: false, reason: null, items: [] };

/**
 * The path of the target's alert from the first breaching reading Studio recorded to the incident, as the Alerts page
 * draws it (`alertTrail`): each step says whose clock its time is on, a step Studio cannot honestly give is left out
 * and the notes say why, and a delivery that has not happened has no incident after it. There is no "Broker ack" step: Studio does
 * not measure it, and a duration between stages on different clocks would be invented.
 */
export function LabTrace({ deviceId, alert }: LabTraceProps) {
  const rules = useStudio((state) => state.view?.rules) ?? NO_RULES;
  const series = useSeries(deviceId ?? '', alert?.metric ?? '');

  if (deviceId === null) {
    return <p className={styles.empty}>Choose a target to follow its alert.</p>;
  }
  if (alert === null) {
    return (
      <p className={styles.empty}>
        No alert has opened on {deviceId} yet. The trace appears when one does.
      </p>
    );
  }
  const trail = alertTrail({
    alert: { ...alert, cause: null },
    rule: ruleOf(rules, alert),
    series,
  });
  return (
    <div className={styles.trace}>
      <p className={styles.traceHead}>
        <b>Alert #{alert.id}</b> on <span className={styles.mono}>{alert.deviceId}</span> ·{' '}
        {alert.status === 'open' ? 'open' : 'cleared'}, {alert.severity}
      </p>
      <AlertTrail trail={trail} />
    </div>
  );
}

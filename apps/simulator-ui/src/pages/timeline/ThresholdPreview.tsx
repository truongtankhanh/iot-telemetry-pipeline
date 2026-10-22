import { useMemo } from 'react';
import type { Anomaly, DeviceInfo, RulesView } from '../../api/types';
import { ruleLineFor, previewItem } from '../../lib/thresholdPreview';
import type { ExpectedImpact } from '../lab/useExpectedImpact';
import { ScenarioChart } from '../scenarios/ScenarioChart';
import styles from './inspector.module.css';
import { anomaliesOf, type EditorDoc } from '../../lib/timelineEditor';
import { seconds } from '../../lib/scenarioExpectation';

export interface ThresholdPreviewProps {
  doc: EditorDoc;
  selected: Anomaly;
  impact: ExpectedImpact;
  rules: RulesView;
  devices: readonly DeviceInfo[];
}

/**
 * The selected anomaly against the rule that watches it (frame 05): the value the simulator expects with the rule's raise
 * and clear lines, the part beyond the raise line in amber, and the alert and the clear as flags, drawn by the Scenarios
 * page's chart so that the two agree; under it the rule in words and when the anomaly starts and ends. With no rule, or
 * before the simulator has answered, there is nothing honest to draw and the chart stays out; the sentences say why.
 */
export function ThresholdPreview({ doc, selected, impact, rules, devices }: ThresholdPreviewProps) {
  const expected = impact.preview?.expected ?? null;
  const item = useMemo(
    () => previewItem(anomaliesOf(doc), selected, expected),
    [doc, selected, expected],
  );
  const rule = ruleLineFor(rules, devices, selected);
  return (
    <div className={styles.preview} data-stale={impact.fresh ? undefined : 'true'}>
      {item === null ? null : (
        <ScenarioChart item={item} rules={rules} devices={devices} running={false} />
      )}
      <p className={styles.previewLine}>{rule ?? 'No rule watches this signal.'}</p>
      <p className={styles.previewLine}>
        Starts {seconds(selected.startAt)} · ends {seconds(selected.startAt + selected.duration)}
      </p>
    </div>
  );
}

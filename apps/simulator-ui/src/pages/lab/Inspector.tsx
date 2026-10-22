import { useId, useState } from 'react';
import type { LabCommand, LogFilter } from '../../lib/labLog';
import { Button } from '../../ui/Button';
import { uiIcons } from '../../ui/icons';
import { Tabs } from '../../ui/Tabs';
import { tabId } from '../../ui/tabId';
import { RuleEvaluationFor } from '../topology/RuleEvaluation';
import { ExecutionLog } from './ExecutionLog';
import styles from './inspector.module.css';
import { LabTrace } from './LabTrace';
import { useTargetInspection } from './useLabInspector';

type InspectorTab = 'log' | 'rules' | 'trace';

const TABS = [
  { id: 'log', label: 'Log' },
  { id: 'rules', label: 'Rules' },
  { id: 'trace', label: 'Trace' },
] as const;

export interface InspectorProps {
  commands: readonly LabCommand[];
  logFilter: LogFilter;
  logPage: number;
  onLogFilter: (filter: LogFilter) => void;
  onLogPage: (page: number) => void;
  /** The devices the fault reaches, in order: the Rules and Trace tabs step through them one at a time. */
  targetIds: readonly string[];
}

/**
 * The execution inspector (frames 12 and 19): the _Log_ of what happened, the _Rules_ evaluation of one target and its
 * _Trace_. With 12 or 100 targets the last two follow one target at a time ("dc-env-01, 1 of 12", previous and next), so a
 * hundred devices are not a hundred cards.
 */
export function Inspector({
  commands,
  logFilter,
  logPage,
  onLogFilter,
  onLogPage,
  targetIds,
}: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('log');
  const inspection = useTargetInspection(targetIds);
  const prefix = useId();
  const panel = `${prefix}-panel`;
  const { step } = inspection;

  const stepper = (
    <div className={styles.stepper} role="group" aria-label="Target">
      {step.total === 0 ? (
        <span className={styles.faint}>No target chosen</span>
      ) : (
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={uiIcons.previous}
            aria-label="Previous target"
            disabled={step.position <= 1}
            onClick={() => inspection.go(-1)}
          />
          <span className={styles.stepLabel}>
            <span className={styles.mono}>{step.id}</span>
            <span className={styles.faint}>
              {step.position} of {step.total}
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={uiIcons.next}
            aria-label="Next target"
            disabled={step.position >= step.total}
            onClick={() => inspection.go(1)}
          />
        </>
      )}
    </div>
  );

  return (
    <div className={styles.inspector}>
      <h2 className={styles.title}>Execution inspector</h2>
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(id) => setTab(id as InspectorTab)}
        label="Inspector"
        idPrefix={prefix}
        panelId={panel}
      />
      <div id={panel} role="tabpanel" aria-labelledby={tabId(prefix, tab)} className={styles.panel}>
        {tab === 'log' ? (
          <ExecutionLog
            commands={commands}
            filter={logFilter}
            page={logPage}
            onFilter={onLogFilter}
            onPage={onLogPage}
          />
        ) : (
          <>
            {stepper}
            {tab === 'rules' ? (
              <RuleEvaluationFor
                target={inspection.target}
                empty={
                  step.id === null
                    ? 'Choose a target to see the rule that watches it.'
                    : 'No rule watches this device.'
                }
                showDevice={false}
              />
            ) : (
              <LabTrace deviceId={step.id} alert={inspection.alert} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

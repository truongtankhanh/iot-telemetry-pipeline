import type { StateView } from '../../api/types';
import { dependencyNotes } from '../../lib/dependencyNotes';
import type { FleetRow } from '../../lib/fleetQuery';
import { lastAnswerAt, type StageId, type StageNode } from '../../lib/pipeline';
import type { Selection } from '../../lib/topology';
import { alertsFor, evaluationTarget, stageChecks, zoneSummary } from '../../lib/topologyDetail';
import { AlertsCard } from './AlertsCard';
import { ChecksCard } from './ChecksCard';
import { DeviceDetail } from './DeviceDetail';
import { RuleEvaluationFor } from './RuleEvaluation';
import { StageDetail } from './StageDetail';
import { ZoneDetail } from './ZoneDetail';
import styles from './detail.module.css';

export interface DetailRowProps {
  view: StateView;
  rows: readonly FleetRow[];
  stages: readonly StageNode[];
  selection: Selection | null;
  lastAlertSink: string | null;
  now: number;
  onSelect: (selection: Selection | null) => void;
}

/** The dependency a stage rests on, for the check shown beside it. */
const CHECK_OF: Record<StageId, 'broker' | 'ingest' | 'alertSink'> = {
  broker: 'broker',
  ingest: 'ingest',
  database: 'ingest',
  rules: 'ingest',
  alert: 'ingest',
  outbox: 'ingest',
  commandCenter: 'alertSink',
};

/**
 * The row under the graph (frame 04): three columns that follow the selection. A device fills them with its detail,
 * the rule evaluation and its alerts; a stage with its facts, the rule evaluation of the newest alert and all alerts;
 * a zone with its devices, the newest alert's rule and the alerts of its devices. With nothing selected and a
 * dependency in trouble, it is the checks and the last alerts, dimmed and dated when ingest does not answer (frame 10);
 * with nothing selected and nothing wrong it only says what to do.
 */
export function DetailRow({
  view,
  rows,
  stages,
  selection,
  lastAlertSink,
  now,
  onSelect,
}: DetailRowProps) {
  const answering = view.ingest.status === 'ready' || view.ingest.status === 'not-ready';
  const asOf = answering ? null : lastAnswerAt(view);
  const alerts = alertsFor(view, selection);
  const consoleUrl = view.config.consoleUrl;
  const checks = stageChecks(view, lastAlertSink);
  const key = selection === null ? 'none' : `${selection.type}:${selection.id}`;

  if (selection === null) {
    const trouble = !answering || dependencyNotes(view, lastAlertSink).length > 0;
    if (!trouble) {
      return (
        <p className={styles.muted}>
          Choose a device, a zone or a stage in the graph to see its readings, the rule and its
          alerts.
        </p>
      );
    }
    return (
      <div className={styles.row} data-columns="2">
        <ChecksCard checks={checks} />
        <AlertsCard
          key={`${key}/alerts`}
          alerts={alerts}
          scope="all devices"
          consoleUrl={consoleUrl}
          asOf={asOf}
        />
      </div>
    );
  }

  if (selection.type === 'device') {
    const row = rows.find((r) => r.device.id === selection.id);
    if (row === undefined) return null;
    const engine = view.engine.devices.find((d) => d.id === selection.id);
    return (
      <div className={styles.row}>
        <DeviceDetail
          key={`${key}/detail`}
          row={row}
          rules={view.rules}
          profiles={view.profiles[selection.id]}
          intervalMs={engine?.intervalMs ?? view.config.intervalMs}
          seq={engine?.seq ?? 0}
          now={now}
        />
        <RuleEvaluationFor
          target={evaluationTarget(view, selection)}
          empty={
            view.rules.available
              ? 'No rule watches this device.'
              : `Rules are not available: ${view.rules.reason ?? 'unknown reason'}.`
          }
          showDevice={false}
        />
        <AlertsCard
          key={`${key}/alerts`}
          alerts={alerts}
          scope={selection.id}
          consoleUrl={consoleUrl}
          asOf={asOf}
        />
      </div>
    );
  }

  const target = evaluationTarget(view, selection);
  const empty = view.rules.available
    ? 'No alert has been raised, so there is no rule to show.'
    : `Rules are not available: ${view.rules.reason ?? 'unknown reason'}.`;

  if (selection.type === 'zone') {
    const summary = zoneSummary(rows, selection.id);
    if (summary === null) return null;
    return (
      <div className={styles.row}>
        <ZoneDetail summary={summary} onSelect={(id) => onSelect({ type: 'device', id })} />
        <RuleEvaluationFor target={target} empty={empty} showDevice />
        <AlertsCard
          key={`${key}/alerts`}
          alerts={alerts}
          scope={selection.id}
          consoleUrl={consoleUrl}
          asOf={asOf}
        />
      </div>
    );
  }

  const stage = stages.find((s) => s.id === selection.id);
  if (stage === undefined) return null;
  return (
    <div className={styles.row}>
      <StageDetail
        stage={stage}
        check={checks.checks.find((c) => c.id === CHECK_OF[stage.id]) ?? null}
        lastRunAt={checks.lastRunAt}
      />
      <RuleEvaluationFor target={target} empty={empty} showDevice />
      <AlertsCard
        key={`${key}/alerts`}
        alerts={alerts}
        scope="all devices"
        consoleUrl={consoleUrl}
        asOf={asOf}
      />
    </div>
  );
}

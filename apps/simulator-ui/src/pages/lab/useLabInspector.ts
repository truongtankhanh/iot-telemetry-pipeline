import { useCallback, useMemo, useState } from 'react';
import type { ObservedAlert } from '../../api/types';
import { paginate } from '../../lib/fleetQuery';
import {
  collapseRuns,
  filterRows,
  type LabCommand,
  type LogFilter,
  logCounts,
  logRows,
  stepTarget,
  type TargetStep,
} from '../../lib/labLog';
import { LAB_LOG_SIZE } from '../../lib/labQuery';
import { type EvaluationTarget, evaluationTarget } from '../../lib/topologyDetail';
import { useObservations } from '../../state/observationContext';
import { useStudio } from '../../state/studioContext';

/**
 * The log of the Lab: the observations that concern faults and alerts merged with the commands Studio sent, filtered
 * (_All / Alerts / Faults_), with runs of alike rows folded ("6 more alerts, #8 to #13"), and paged. A folded run opens
 * and closes by its key. The page number is the address's; a page past the end is the last one.
 */
export function useLabLog(commands: readonly LabCommand[], filter: LogFilter, page: number) {
  const { events } = useObservations();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const rows = useMemo(() => logRows(events, commands), [events, commands]);
  const counts = useMemo(() => logCounts(rows), [rows]);
  const items = useMemo(() => collapseRuns(filterRows(rows, filter), open), [rows, filter, open]);
  const shown = useMemo(() => paginate(items, page, LAB_LOG_SIZE), [items, page]);

  const toggleRun = useCallback((key: string) => {
    setOpen((were) => {
      const next = new Set(were);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  return { counts, shown, open, toggleRun };
}

export interface TargetInspection {
  /** Which target the inspector is on and its place among them ("dc-env-01, 1 of 12"). */
  step: TargetStep;
  /** Moves by one target; the arrows stop at the ends. */
  go: (delta: -1 | 1) => void;
  /** The rule that watches the target and the newest alert it raised, or `null` when no rule applies. */
  target: EvaluationTarget | null;
  /** The newest alert on the target, whichever rule raised it. */
  alert: ObservedAlert | null;
}

/**
 * The rule evaluation and the trace follow one target at a time, so 100 devices are not 100 cards. The readings are the
 * history's, read by the components that draw them (`useSeries`); this hook only chooses what they are about.
 */
export function useTargetInspection(targetIds: readonly string[]): TargetInspection {
  const view = useStudio((state) => state.view);
  const [selected, setSelected] = useState<string | null>(null);
  const step = useMemo(() => stepTarget(targetIds, selected), [targetIds, selected]);

  const go = useCallback(
    (delta: -1 | 1) => setSelected(stepTarget(targetIds, step.id, delta).id),
    [targetIds, step.id],
  );

  const target = useMemo(
    () =>
      view === null || step.id === null
        ? null
        : evaluationTarget(view, { type: 'device', id: step.id }),
    [view, step.id],
  );
  const alert = useMemo(
    () =>
      view === null || step.id === null
        ? null
        : (view.alerts.alerts.find((candidate) => candidate.deviceId === step.id) ?? null),
    [view, step.id],
  );

  return { step, go, target, alert };
}

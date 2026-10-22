import { useCallback, useMemo, useState } from 'react';
import type { DeviceInfo, RulesView } from '../../api/types';
import { DEFAULT_FAULT, type FaultDraft, type FaultPlan, planFault } from '../../lib/labFault';
import { useStudio } from '../../state/studioContext';

const NO_RULES: RulesView = {
  available: false,
  reason: 'The simulator has not sent its rules yet',
  items: [],
};
const NO_PROFILES = {};
const NO_ANOMALIES: never[] = [];

/**
 * The fault being configured: what the form holds, and, worked out from it and from the devices chosen, the metric and
 * value in force, the anomalies it makes, what stops it from being sent and why (`FaultPlan`). The form's numbers are
 * page state, not the address's; the plan is recomputed from them and from the engine, so an anomaly that appears on a
 * target (someone else's, or an earlier injection) blocks the buttons at once, with its name.
 */
export function useLabFault(reached: readonly DeviceInfo[]): {
  draft: FaultDraft;
  patch: (change: Partial<FaultDraft>) => void;
  plan: FaultPlan;
} {
  const rules = useStudio((state) => state.view?.rules) ?? NO_RULES;
  const profiles = useStudio((state) => state.view?.profiles) ?? NO_PROFILES;
  const anomalies = useStudio((state) => state.view?.engine.anomalies) ?? NO_ANOMALIES;
  const elapsedS = useStudio((state) => state.view?.engine.elapsedS) ?? 0;
  const [draft, setDraft] = useState<FaultDraft>(DEFAULT_FAULT);

  // Another metric has another range and another rule: its value starts again from the rule.
  const patch = useCallback((change: Partial<FaultDraft>) => {
    setDraft((current) => ({
      ...current,
      ...change,
      ...(change.metric !== undefined &&
      change.metric !== current.metric &&
      change.value === undefined
        ? { value: null }
        : {}),
    }));
  }, []);

  const plan = useMemo(
    () => planFault({ draft, reached, rules, profiles, engine: { anomalies, elapsedS } }),
    [draft, reached, rules, profiles, anomalies, elapsedS],
  );

  return { draft, patch, plan };
}

import { useMemo } from 'react';
import type { Expected, RuleInfo, ScenarioItem, StateView } from '../../api/types';
import type { MatchInputs } from '../../lib/demoEvents';
import type { DemoScript, DemoStep } from '../../lib/demoScript';
import type { DemoFacts } from '../../lib/demoText';
import type { IngestRates } from '../../lib/ingestRates';
import { useSeries } from '../../state/historyContext';
import { useObservations } from '../../state/observationContext';
import type { LinkState } from '../../state/store';
import { useStudio } from '../../state/studioContext';
import { useNow } from '../../state/useNow';
import { useIngestRates } from '../topology/useTopologyModel';
import { type ScenarioLibraryResult, useScenarioLibrary } from '../scenarios/useScenarioLibrary';

/** Everything the guided demo reads from Studio, gathered in one place so the driver and the view read the same things. */
export interface DemoLive {
  /** The last state the simulator sent, `null` before the first. */
  view: StateView | null;
  link: LinkState;
  lastAlertSink: string | null;
  /** The clock of the page, renewed each second: a wait, a time limit and the dwell are all measured by it. */
  now: number;
  library: ScenarioLibraryResult;
  rates: IngestRates;
  /** What the `{tokens}` of the script's text read. */
  facts: DemoFacts;
  /** What the matchers read. */
  inputs: MatchInputs;
  /** The rule the current step is about (the script's, when the step awaits nothing); `null` when the simulator has no rules. */
  rule: RuleInfo | null;
  /** The scenario the script plays, as the library lists it. */
  scenarioItem: ScenarioItem | null;
  /** What the rules should do with it, from the library. */
  expected: Expected | null;
}

/**
 * The data of the guided demo for the step on screen: the state, the observations, the readings of the metric of the rule the step is
 * about, and the scenario library. It renders about once a second (the clock, the observation log, the history), never per message.
 * `step` is the current step, `undefined` before the demo started.
 */
export function useDemoFacts(script: DemoScript, step: DemoStep | undefined): DemoLive {
  const view = useStudio((state) => state.view);
  const link = useStudio((state) => state.link);
  const lastAlertSink = useStudio((state) => state.lastAlertSink);
  const publishRate = useStudio((state) => state.publishRate);
  const observations = useObservations();
  const now = useNow(1000);
  const library = useScenarioLibrary();
  const rates = useIngestRates(view?.metrics);

  const ruleId = step?.await?.ruleId ?? script.subject.ruleId;
  const deviceId = step?.await?.deviceId ?? script.subject.deviceId;
  const rules = view?.rules;
  const rule = useMemo(
    () => rules?.items.find((item) => item.id === ruleId) ?? null,
    [rules, ruleId],
  );
  const series = useSeries(deviceId, rule?.metric ?? script.subject.metric);

  const alerts = view?.alerts.alerts;
  const inputs = useMemo<MatchInputs>(
    () => ({
      events: observations.events,
      newestId: observations.newestId,
      series,
      rule,
      alerts: alerts ?? [],
    }),
    [observations, series, rule, alerts],
  );

  const scenarioItem = useMemo(
    () => library.library?.scenarios.find((item) => item.name === script.scenario) ?? null,
    [library.library, script.scenario],
  );

  const deviceCount = view?.devices.length;
  const hasView = view !== null;
  const subject = script.subject;
  const facts = useMemo<DemoFacts>(
    () => ({
      devices: deviceCount ?? null,
      rate: hasView ? publishRate : null,
      rule: rules?.items.find((item) => item.id === subject.ruleId) ?? null,
      scenario: scenarioItem,
      subject,
    }),
    [deviceCount, hasView, publishRate, rules, subject, scenarioItem],
  );

  return {
    view,
    link,
    lastAlertSink,
    now,
    library,
    rates,
    facts,
    inputs,
    rule,
    scenarioItem,
    expected: scenarioItem?.expected ?? null,
  };
}

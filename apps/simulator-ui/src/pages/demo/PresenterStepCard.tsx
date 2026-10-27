import { countSentence, happenedSentence } from '../../lib/demoWaiting';
import { metricUnit } from '../../lib/deviceIdentity';
import { formatValue, isBeyond } from '../../lib/rules';
import { type HotFact, StepCard } from './StepCard';
import type { DemoDriver } from './useDemoDriver';

/** The three small facts under the waiting block: that the scenario started, that the broker takes the readings, and when the alert should open. */
function factsOf(driver: DemoDriver): HotFact[] {
  const { step, scenarioStarted, alertOpensInS, live } = driver;
  if (step === undefined) return [];
  const facts: HotFact[] = [];
  if (step.action?.type === 'run-scenario') {
    facts.push({ done: scenarioStarted, text: 'Scenario started' });
  }
  if (
    step.action !== undefined ||
    step.await?.type === 'rule-raised' ||
    step.await?.type === 'alert-opened'
  ) {
    facts.push({ done: live.view?.broker.connected === true, text: 'Broker accepts the readings' });
  }
  if (alertOpensInS !== null) {
    facts.push({
      done: false,
      text:
        alertOpensInS === 0
          ? 'Alert about to open'
          : `Alert opens about ${alertOpensInS} s from now`,
    });
  }
  return facts;
}

export interface PresenterStepCardProps {
  driver: DemoDriver;
  /** The card at the size that fits beside the twin's scene instead of a whole column (SIM-21). */
  compact?: boolean;
}

/**
 * The current step of the guided demo (frame 08), from the driver: the step's text with its `{tokens}` filled, how its wait is
 * going, the newest reading under watch, the facts and the way on. The presenter view and the twin's dock both draw it, so what a
 * step says and does is one thing in two places. Nothing here moves the step; the driver does.
 */
export function PresenterStepCard({ driver, compact }: PresenterStepCardProps) {
  const { script, step, text, live, actions } = driver;
  if (step === undefined) return null;

  const latest = live.inputs.series.at(-1);
  const metric = live.rule?.metric ?? script.subject.metric;
  const reading =
    latest === undefined
      ? null
      : {
          value: formatValue(metric, latest.v),
          unit: metricUnit(metric),
          breach: live.rule === null ? false : isBeyond(live.rule, latest.v),
        };
  const next = script.steps[driver.index + 1];

  return (
    <StepCard
      index={driver.index}
      count={driver.count}
      title={text(step.title)}
      say={text(step.say)}
      phase={driver.phase}
      waitingFor={driver.waitingFor}
      awaitType={step.await?.type ?? null}
      detail={
        step.await === undefined ? null : countSentence(step.await, live.rule, driver.progress)
      }
      reading={reading}
      cause={driver.cause}
      late={driver.late}
      moveOnLabel={driver.moveOnLabel}
      happened={step.await === undefined ? null : happenedSentence[step.await.type]}
      failure={driver.startFailure}
      movedOn={driver.movedOn}
      scenarioRunning={driver.scenarioStarted}
      sinceStartS={driver.sinceStartS}
      facts={factsOf(driver)}
      nextTitle={next === undefined ? null : text(next.title)}
      canBack={driver.index > 0}
      notes={step.notes === undefined ? null : text(step.notes)}
      notesOpen={driver.notesOpen}
      notice={driver.notice}
      compact={compact}
      onNext={actions.next}
      onBack={actions.back}
      onRestart={() => void actions.restart()}
      onRetry={actions.retry}
      onToggleNotes={actions.toggleNotes}
    />
  );
}

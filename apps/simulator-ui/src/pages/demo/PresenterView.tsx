import { useEffect } from 'react';
import { countSentence, happenedSentence } from '../../lib/demoWaiting';
import { stepStanding } from '../../lib/demoSession';
import { scriptLine } from '../../lib/demoText';
import { metricUnit } from '../../lib/deviceIdentity';
import { formatValue, isBeyond } from '../../lib/rules';
import { Kbd } from '../../ui/Kbd';
import styles from './demo.module.css';
import { PipelineStrip } from './PipelineStrip';
import { StepCard, type HotFact } from './StepCard';
import { StepList } from './StepList';
import type { DemoDriver } from './useDemoDriver';

export interface PresenterViewProps {
  driver: DemoDriver;
}

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

/**
 * The presenter view (frame 08): the steps on the left; on the right the current step, the pipeline so far and the keys. The
 * navigation is not here (the shell leaves it out while presenting). Focus goes to the primary button when the view appears, so a
 * presenter who started from the keyboard can go on from it; it does not move when a step moves on by itself.
 */
export function PresenterView({ driver }: PresenterViewProps) {
  const { script, session, step, text, live, actions } = driver;

  useEffect(() => {
    document.querySelector<HTMLElement>('button[aria-keyshortcuts="Space"]')?.focus();
  }, []);

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
    <div className={styles.pres}>
      <StepList
        items={script.steps.map((entry, index) => ({
          id: entry.id,
          title: text(entry.title),
          summary: text(entry.summary),
          standing: stepStanding(session, index),
        }))}
        scriptLine={scriptLine(script, live.scenarioItem)}
      />
      <div className={styles.main}>
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
          onNext={actions.next}
          onBack={actions.back}
          onRestart={() => void actions.restart()}
          onRetry={actions.retry}
          onToggleNotes={actions.toggleNotes}
        />
        <PipelineStrip stages={driver.stages} />
        <div className={styles.keys}>
          <span>
            <Kbd>Space</Kbd> next
          </span>
          <span>
            <Kbd>←</Kbd> back
          </span>
          <span>
            <Kbd>P</Kbd> {driver.devicesPaused ? 'resume devices' : 'pause devices'}
          </span>
          <span>
            <Kbd>R</Kbd> restart
          </span>
          {step.notes === undefined ? null : (
            <span>
              <Kbd>N</Kbd> presenter notes
            </span>
          )}
          <span>
            <Kbd>Esc</Kbd> exit
          </span>
        </div>
      </div>
    </div>
  );
}

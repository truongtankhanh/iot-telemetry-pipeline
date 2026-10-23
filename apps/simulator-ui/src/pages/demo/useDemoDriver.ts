import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  holdValue,
  pauseDevice,
  releaseValue,
  startDevice,
  stopScenario,
} from '../../api/client';
import { BULK_CONFIRM_ABOVE, BULK_WORDS } from '../../lib/bulk';
import { metricUnit } from '../../lib/deviceIdentity';
import {
  type Baseline,
  beginStep,
  matchAwait,
  milestones,
  takeBaseline,
} from '../../lib/demoEvents';
import { demoPipeline, type DemoStage } from '../../lib/demoPipeline';
import type { DemoScript, DemoStep } from '../../lib/demoScript';
import { elapsedMs, isSatisfied, type DemoSessionState } from '../../lib/demoSession';
import { fillText } from '../../lib/demoText';
import {
  alertOpensIn,
  type Cause,
  DEFAULT_TIMEOUT_S,
  happenedSentence,
  likelyCause,
  moveOnLabel,
  timeoutFor,
  waitingSentence,
} from '../../lib/demoWaiting';
import { formatValue } from '../../lib/rules';
import { runFor, scenarioElapsedS } from '../../lib/runClock';
import { useDemoSession, useDemoSessionStore } from '../../state/demoSessionContext';
import { useStudioStore } from '../../state/studioContext';
import { useBulkRun } from '../fleet/useBulkRun';
import { type CommandNotice, useScenarioCommands } from '../scenarios/useScenarioCommands';
import { useDemoFacts } from './useDemoFacts';

/** How long "Moved on: the alert opened" stays on screen after a step moves on by itself, in ms. */
export const MOVED_ON_VISIBLE_MS = 10_000;

/**
 * Where a step stands. `none`: it waits for nothing. `starting`: its action has not happened yet. `failed`: it was refused (the
 * reason is `startError`) or is waiting for the answer to the replace question. `waiting`, `slow` (past its time limit) and `done`
 * (its event happened).
 */
export type StepPhase = 'none' | 'starting' | 'failed' | 'waiting' | 'slow' | 'done';

const noop = () => {};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The run the step asked for is a new one: there is a run of the scenario now, and it is not the one there was before. */
const started = (runs: Parameters<typeof runFor>[0], scenario: string, before: string | null) => {
  const run = runFor(runs, scenario);
  return run !== undefined && run.id !== before;
};

interface Parked {
  kind: 'enter' | 'restart';
  stepId: string;
  scenario: string;
  /** The id of the run of the scenario that there was when the command was given. */
  before: string | null;
  baseline: Baseline;
}

/**
 * Everything the guided demo does and shows, apart from drawing it: the session (a pure reducer in a store of the window), the data
 * the steps read, the commands they give, and what the view needs to say.
 *
 * - **Entering a step** (once, when it first comes on screen while presenting): takes its baseline, then does its action. A scenario is
 *   run through `useScenarioCommands`, the hook the Scenarios page and the Overview use, so a run that something is in the way of
 *   asks the same question (`pendingReplace`). A held value goes through `holdValue` and is released when the demo finishes. A refused
 *   action keeps the step on screen with the simulator's reason and a Retry; the step does not wait until its action happened.
 * - **Matching** (every render, about once a second): when the awaited event has happened the session moves on by itself, after the
 *   dwell. A time limit only changes what the view says (`phase: 'slow'`); it never moves on.
 * - **`Esc`** (`exit`) stops nothing.
 */
export function useDemoDriver(script: DemoScript) {
  const store = useStudioStore();
  const sessionStore = useDemoSessionStore();
  const session = useDemoSession();

  const step: DemoStep | undefined = script.steps[session.stepIndex];
  const live = useDemoFacts(script, step);
  const commands = useScenarioCommands({ onChanged: live.library.refresh, onImported: noop });
  const bulk = useBulkRun();

  const [startError, setStartError] = useState<{ stepId: string; text: string } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notice, setNotice] = useState<CommandNotice | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  // The newest render's values, for the commands that wait for the simulator and must not use the ones they were created with.
  const latest = useRef({ live, commands });
  useEffect(() => {
    latest.current = { live, commands };
  });
  const parked = useRef<Parked | null>(null);
  const attempted = useRef<string | null>(null);

  const stepIds = useMemo(() => script.steps.map((entry) => entry.id), [script]);

  // ---- entering a step ----
  const enter = useCallback(
    async (index: number) => {
      const target = script.steps[index];
      if (target === undefined) return;
      const previousStep = script.steps[index - 1];
      const previous =
        previousStep === undefined ? null : (sessionStore.get().baselines[previousStep.id] ?? null);
      const baseline = beginStep(target, previous, latest.current.live.inputs, Date.now());
      const action = target.action;

      if (action?.type === 'run-scenario') {
        const before = runFor(store.getState().view?.runs ?? [], action.scenario)?.id ?? null;
        parked.current = {
          kind: 'enter',
          stepId: target.id,
          scenario: action.scenario,
          before,
          baseline,
        };
        await latest.current.commands.run(action.scenario);
        // A refused run, or one waiting for the answer to the replace question, leaves the step not entered.
        if (!started(store.getState().view?.runs ?? [], action.scenario, before)) return;
        parked.current = null;
      } else if (action?.type === 'hold-value') {
        try {
          store
            .getState()
            .setView(await holdValue(action.deviceId, action.metric, action.value), Date.now());
        } catch (error) {
          setStartError({ stepId: target.id, text: message(error) });
          return;
        }
        sessionStore.dispatch({
          type: 'track-hold',
          hold: { deviceId: action.deviceId, metric: action.metric },
        });
      }
      sessionStore.dispatch({ type: 'enter', stepId: target.id, baseline });
    },
    [script, sessionStore, store],
  );

  // A step is entered once, the first time it is on screen while presenting. A refused one is not tried again by itself.
  useEffect(() => {
    if (session.status !== 'presenting' || step === undefined) return;
    if (session.entered.includes(step.id)) return;
    const key = `${session.startedAt}:${step.id}`;
    if (attempted.current === key) return;
    attempted.current = key;
    void enter(session.stepIndex);
  }, [session.status, session.stepIndex, session.entered, session.startedAt, step, enter]);

  // ---- the awaited event ----
  useEffect(() => {
    if (session.status !== 'presenting' || step?.await === undefined) return;
    const baseline = session.baselines[step.id];
    if (baseline === undefined || session.satisfied.includes(step.id)) return;
    if (matchAwait(step.await, baseline, live.inputs).status !== 'satisfied') return;
    // The reducer holds it back until the step has been on screen for the dwell; the next render (within a second) asks again.
    sessionStore.dispatch({
      type: 'event-satisfied',
      stepId: step.id,
      stepIds,
      now: Date.now(),
    });
  }, [session, step, live.inputs, live.now, stepIds, sessionStore]);

  // ---- the run clock stops when the engine does ----
  const engineRunning = live.view?.engine.running;
  useEffect(() => {
    if (engineRunning === undefined || session.startedAt === null) return;
    sessionStore.dispatch({ type: 'engine', running: engineRunning, now: Date.now() });
  }, [engineRunning, session.startedAt, sessionStore]);

  // ---- values the script held are let go when the demo finishes ----
  /** Lets go of the values the script held. Answers the reason when one could not be let go (the rest stay held), `null` when all were. */
  const releaseHolds = useCallback(
    async (holds: DemoSessionState['holds']): Promise<string | null> => {
      for (const hold of holds) {
        try {
          store.getState().setView(await releaseValue(hold.deviceId, hold.metric), Date.now());
        } catch (error) {
          return `${hold.deviceId} ${hold.metric}: ${message(error)}`;
        }
      }
      sessionStore.dispatch({ type: 'release-holds' });
      return null;
    },
    [sessionStore, store],
  );
  const finishedHolds = session.status === 'finished' ? session.holds : null;
  useEffect(() => {
    if (finishedHolds === null || finishedHolds.length === 0) return;
    // The reason is set in the callback of the answer, not by the effect.
    void releaseHolds(finishedHolds).then(setReleaseError);
  }, [finishedHolds, releaseHolds]);

  // ---- what the view says ----
  const now = live.now;
  const entered = step !== undefined && session.entered.includes(step.id);
  const satisfiedBefore = step !== undefined && isSatisfied(session, step.id);
  const baseline = step === undefined ? undefined : session.baselines[step.id];
  const result =
    step?.await !== undefined && baseline !== undefined
      ? matchAwait(step.await, baseline, live.inputs)
      : null;

  const timeoutS = step === undefined ? DEFAULT_TIMEOUT_S : timeoutFor(step, live.expected);
  const sinceStartS = session.stepStartedAt === null ? 0 : (now - session.stepStartedAt) / 1000;

  const runAction = step?.action?.type === 'run-scenario' ? step.action : undefined;
  const runError = runAction === undefined ? null : commands.errorOf(runAction.scenario);
  const failure =
    step !== undefined && startError?.stepId === step.id && !entered
      ? startError.text
      : !entered
        ? runError
        : null;
  const pendingReplace = commands.pending;

  let phase: StepPhase = 'none';
  if (step?.await !== undefined) {
    if (satisfiedBefore || result?.status === 'satisfied') phase = 'done';
    else if (!entered) phase = failure !== null || pendingReplace !== null ? 'failed' : 'starting';
    else phase = sinceStartS >= timeoutS ? 'slow' : 'waiting';
  } else if (step !== undefined && !entered && (failure !== null || pendingReplace !== null)) {
    phase = 'failed';
  } else if (step !== undefined && !entered) {
    phase = 'starting';
  }

  const progress = result?.status === 'waiting' ? result.progress : null;
  const cause: Cause | null =
    step?.await !== undefined && (phase === 'waiting' || phase === 'slow')
      ? likelyCause({
          link: live.link,
          view: live.view,
          awaited: step.await,
          alreadyOpen: progress?.alreadyOpen ?? false,
        })
      : null;
  // A step that cannot finish says so at once and offers the way on; a slow one does after its time limit.
  const late = phase === 'slow' || (cause !== null && cause.code !== 'link-lost');

  const view = live.view;
  const run = view === null ? undefined : runFor(view.runs, script.scenario);
  const scenarioLengthS = live.scenarioItem?.lengthS;
  const scenarioElapsed =
    view !== null && run !== undefined && scenarioLengthS !== undefined
      ? scenarioElapsedS(run, view.engine, now, scenarioLengthS)
      : null;
  const alertOpensInS =
    step?.await !== undefined &&
    (step.await.type === 'rule-raised' || step.await.type === 'alert-opened') &&
    scenarioElapsed !== null
      ? alertOpensIn(live.expected, step.await, scenarioElapsed)
      : null;

  // The strip under the step: how far the subject's chain has got since the script started it, whatever step is on screen.
  const chainBaseline: Baseline | null = useMemo(() => {
    const starting = script.steps.find(
      (entry) => entry.action !== undefined && session.baselines[entry.id] !== undefined,
    );
    if (starting !== undefined) return session.baselines[starting.id] ?? null;
    return (
      script.steps.map((entry) => session.baselines[entry.id]).find((b) => b !== undefined) ?? null
    );
  }, [script, session.baselines]);
  const reached = milestones(script.subject, chainBaseline, live.inputs);
  const latestReading = live.inputs.series.at(-1);
  const subjectMetric = live.rule?.metric ?? script.subject.metric;
  const stages: DemoStage[] = demoPipeline({
    deviceId: script.subject.deviceId,
    reading:
      latestReading === undefined
        ? null
        : { value: formatValue(subjectMetric, latestReading.v), unit: metricUnit(subjectMetric) },
    ingestStatus: view?.ingest.status ?? 'unknown',
    lagSeconds: live.rates.lagSeconds,
    rule: reached.of === null ? null : { counted: reached.counted ?? 0, of: reached.of },
    ruleRaised: reached.ruleRaised,
    alert: reached.alert,
    incident: reached.incident,
    alertSink: view?.ingest.alertSink ?? live.lastAlertSink,
    linkLost: live.link === 'lost',
  });

  // "Moved on: the alert opened", for a few seconds after a step moved on by itself.
  const previousStep = script.steps[session.stepIndex - 1];
  const movedOn =
    previousStep?.await !== undefined &&
    session.advancedBy[previousStep.id] === 'event' &&
    session.stepStartedAt !== null &&
    now - session.stepStartedAt < MOVED_ON_VISIBLE_MS
      ? happenedSentence[previousStep.await.type]
      : null;

  // ---- commands ----
  const start = useCallback(() => {
    setReleaseError(null);
    sessionStore.dispatch({
      type: 'start',
      scriptId: script.id,
      stepCount: script.steps.length,
      now: Date.now(),
    });
  }, [script, sessionStore]);
  const next = useCallback(
    () => sessionStore.dispatch({ type: 'next', stepId: step?.id, now: Date.now() }),
    [sessionStore, step],
  );
  const back = useCallback(
    () => sessionStore.dispatch({ type: 'back', now: Date.now() }),
    [sessionStore],
  );
  const exit = useCallback(() => sessionStore.dispatch({ type: 'exit' }), [sessionStore]);
  const resume = useCallback(
    () => sessionStore.dispatch({ type: 'resume', now: Date.now() }),
    [sessionStore],
  );
  const toggleNotes = useCallback(() => setNotesOpen((open) => !open), []);

  const retry = useCallback(() => {
    setStartError(null);
    void enter(sessionStore.get().stepIndex);
  }, [enter, sessionStore]);

  const finishParked = useCallback(() => {
    const pending = parked.current;
    if (pending === null) return;
    if (!started(store.getState().view?.runs ?? [], pending.scenario, pending.before)) return;
    parked.current = null;
    if (pending.kind === 'restart') {
      sessionStore.dispatch({
        type: 'restart-step',
        stepId: pending.stepId,
        baseline: pending.baseline,
        now: Date.now(),
      });
    } else {
      sessionStore.dispatch({ type: 'enter', stepId: pending.stepId, baseline: pending.baseline });
    }
  }, [sessionStore, store]);

  const confirmReplace = useCallback(async () => {
    await latest.current.commands.confirmReplace();
    finishParked();
  }, [finishParked]);
  const cancelReplace = useCallback(() => latest.current.commands.cancelReplace(), []);

  /** `R`: the step begins again from now. A scenario is stopped and run again; a hold is held again; a wait just starts counting again. */
  const restart = useCallback(async () => {
    const target = script.steps[sessionStore.get().stepIndex];
    if (target === undefined) return;
    setNotice(null);
    try {
      const action = target.action;
      if (action?.type === 'run-scenario') {
        try {
          store.getState().setView(await stopScenario(action.scenario), Date.now());
        } catch (error) {
          // Not running is the state it was going to be put in.
          if (!(error instanceof ApiError && error.status === 409)) throw error;
        }
        const baseline = takeBaseline(latest.current.live.inputs, target.await, Date.now());
        const before = runFor(store.getState().view?.runs ?? [], action.scenario)?.id ?? null;
        parked.current = {
          kind: 'restart',
          stepId: target.id,
          scenario: action.scenario,
          before,
          baseline,
        };
        await latest.current.commands.run(action.scenario);
        finishParked();
        return;
      }
      if (action?.type === 'hold-value') {
        store
          .getState()
          .setView(await holdValue(action.deviceId, action.metric, action.value), Date.now());
        sessionStore.dispatch({
          type: 'track-hold',
          hold: { deviceId: action.deviceId, metric: action.metric },
        });
      }
      sessionStore.dispatch({
        type: 'restart-step',
        stepId: target.id,
        baseline: takeBaseline(latest.current.live.inputs, target.await, Date.now()),
        now: Date.now(),
      });
    } catch (error) {
      setNotice({ tone: 'bad', text: message(error) });
    }
  }, [script, sessionStore, store, finishParked]);

  /** `P`: pauses every running device, or starts the paused ones again when none is running (D2: up to `BULK_CONFIRM_ABOVE` devices). */
  const togglePause = useCallback(async () => {
    const current = store.getState().view;
    if (current === null || bulk.state.running) return;
    if (current.engine.simulated) {
      setNotice({
        tone: 'bad',
        text: 'Pause is not available on the simulated clock: nothing publishes by itself.',
      });
      return;
    }
    const running = current.engine.devices.filter((d) => d.state === 'running').map((d) => d.id);
    const paused = current.engine.devices.filter((d) => d.state === 'paused').map((d) => d.id);
    const action = running.length > 0 ? 'pause' : 'start';
    const ids = action === 'pause' ? running : paused;
    if (ids.length === 0) {
      setNotice({ tone: 'bad', text: 'No device to pause or resume.' });
      return;
    }
    if (ids.length > BULK_CONFIRM_ABOVE) {
      setNotice({
        tone: 'bad',
        text: `Pause asks for a confirmation above ${BULK_CONFIRM_ABOVE} devices: use the Overview.`,
      });
      return;
    }
    const results = await bulk.run(
      ids,
      BULK_WORDS[action].doing,
      action === 'pause' ? (id) => pauseDevice(id) : (id) => startDevice(id),
    );
    if (results === null) return;
    const done = results.filter((r) => r.ok).length;
    const failed = results.find((r) => !r.ok);
    setNotice(
      failed === undefined
        ? {
            tone: 'ok',
            text: `${BULK_WORDS[action].done} ${done} ${done === 1 ? 'device' : 'devices'}.`,
          }
        : { tone: 'bad', text: `${failed.id}: ${failed.error ?? 'failed'}` },
    );
    bulk.dismiss();
  }, [bulk, store]);

  /** From the start screen: lets go of what the script held, then forgets the session. Runs it started keep playing. */
  const stopDemo = useCallback(async () => {
    const error = await releaseHolds(sessionStore.get().holds);
    setReleaseError(error);
    if (error === null) sessionStore.dispatch({ type: 'reset' });
  }, [releaseHolds, sessionStore]);

  const text = useCallback((value: string) => fillText(value, live.facts), [live.facts]);
  const devices = view?.engine.devices ?? [];
  const devicesPaused =
    !devices.some((d) => d.state === 'running') && devices.some((d) => d.state === 'paused');

  return {
    script,
    session,
    step,
    index: session.stepIndex,
    count: script.steps.length,
    live,
    text,
    elapsedMs: elapsedMs(session, now),
    entered,
    phase,
    progress,
    waitingFor: step?.await === undefined ? null : waitingSentence(step.await),
    cause,
    late,
    moveOnLabel: step?.await === undefined ? null : moveOnLabel[step.await.type],
    timeoutS,
    sinceStartS,
    alertOpensInS,
    scenarioStarted: runAction !== undefined && entered,
    startFailure: failure,
    pendingReplace,
    replaceBusy: runAction === undefined ? false : commands.isBusy(runAction.scenario, 'run'),
    movedOn,
    stages,
    reached,
    notesOpen,
    notice,
    dismissNotice: () => setNotice(null),
    pauseState: bulk.state,
    devicesPaused,
    releaseError,
    actions: {
      start,
      next,
      back,
      exit,
      resume,
      restart,
      togglePause,
      toggleNotes,
      retry,
      stopDemo,
      confirmReplace,
      cancelReplace,
    },
  };
}

export type DemoDriver = ReturnType<typeof useDemoDriver>;

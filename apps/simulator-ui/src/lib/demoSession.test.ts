import { describe, expect, it } from 'vitest';
import type { Baseline } from './demoEvents';
import {
  type DemoSessionAction,
  demoSessionReducer,
  type DemoSessionState,
  elapsedMs,
  formatElapsed,
  INITIAL_SESSION,
  isActive,
  isSatisfied,
  MIN_DWELL_MS,
  stepStanding,
} from './demoSession';

const STEP_IDS = ['normal', 'rule', 'heat', 'alert', 'incident', 'recover'];

const baseline = (observationId = 0): Baseline => ({
  observationId,
  seriesT: null,
  openAlertIds: [],
  at: 0,
});

const run = (state: DemoSessionState, ...actions: DemoSessionAction[]): DemoSessionState =>
  actions.reduce(demoSessionReducer, state);

const started = (now = 1_000): DemoSessionState =>
  run(INITIAL_SESSION, { type: 'start', scriptId: 'overheat', stepCount: 6, now });

/** An event for the step at `index`, `after` ms after the step came on screen. */
const event = (
  state: DemoSessionState,
  index: number,
  after = MIN_DWELL_MS,
): DemoSessionAction => ({
  type: 'event-satisfied',
  stepId: STEP_IDS[index] as string,
  stepIds: STEP_IDS,
  now: (state.stepStartedAt ?? 0) + after,
});

describe('start', () => {
  it('presents step 0 and starts the clock', () => {
    const state = started(5_000);
    expect(state).toMatchObject({
      scriptId: 'overheat',
      stepCount: 6,
      stepIndex: 0,
      status: 'presenting',
      startedAt: 5_000,
      stepStartedAt: 5_000,
      satisfied: [],
      entered: [],
    });
  });

  it('refuses a script with no steps', () => {
    expect(run(INITIAL_SESSION, { type: 'start', scriptId: 'x', stepCount: 0, now: 1 })).toBe(
      INITIAL_SESSION,
    );
  });

  it('starts again from the first step and keeps the holds that are still on the devices', () => {
    const hold = { deviceId: 'dc-env-01', metric: 'temperature_c' };
    const before = run(started(), { type: 'track-hold', hold }, { type: 'next', now: 2_000 });
    const again = run(before, { type: 'start', scriptId: 'overheat', stepCount: 6, now: 9_000 });
    expect(again.stepIndex).toBe(0);
    expect(again.satisfied).toEqual([]);
    expect(again.holds).toEqual([hold]);
  });
});

describe('next and back', () => {
  it('next moves one step on, resets the dwell and notes that it was by hand', () => {
    const state = run(started(), { type: 'next', stepId: 'normal', now: 3_000 });
    expect(state).toMatchObject({ stepIndex: 1, stepStartedAt: 3_000 });
    expect(state.advancedBy).toEqual({ normal: 'manual' });
    expect(state.satisfied).toEqual([]);
  });

  it('next is allowed on a step that waits for something that has not happened', () => {
    const at3 = run(started(), { type: 'next', now: 2 }, { type: 'next', now: 3 });
    expect(run(at3, { type: 'next', now: 4 }).stepIndex).toBe(3);
  });

  it('next on the last step finishes the demo', () => {
    let state = started();
    for (let i = 0; i < 5; i++) state = run(state, { type: 'next', now: 2_000 + i });
    expect(state.stepIndex).toBe(5);
    const done = run(state, { type: 'next', now: 9_000 });
    expect(done.status).toBe('finished');
    expect(done.stepIndex).toBe(5);
  });

  it('back shows the step before, undoes nothing, and does nothing on the first step', () => {
    const entered = run(
      started(),
      { type: 'enter', stepId: 'normal', baseline: baseline(1) },
      { type: 'next', now: 2_000 },
    );
    const back = run(entered, { type: 'back', now: 3_000 });
    expect(back).toMatchObject({ stepIndex: 0, stepStartedAt: 3_000 });
    expect(back.entered).toEqual(['normal']);
    expect(back.baselines).toEqual({ normal: baseline(1) });
    expect(run(back, { type: 'back', now: 4_000 })).toBe(back);
  });

  it('ignores both when the demo is not being presented', () => {
    const exited = run(started(), { type: 'exit' });
    expect(run(exited, { type: 'next', now: 2 })).toBe(exited);
    expect(run(exited, { type: 'back', now: 2 })).toBe(exited);
    expect(run(INITIAL_SESSION, { type: 'next', now: 2 })).toBe(INITIAL_SESSION);
  });
});

describe('event-satisfied', () => {
  const atStep = (index: number): DemoSessionState => {
    let state = started(1_000);
    for (let i = 0; i < index; i++)
      state = run(state, { type: 'next', now: 1_000 + (i + 1) * 100 });
    return state;
  };

  it('moves on by itself, marks the step satisfied and notes it was by an event', () => {
    const state = atStep(2);
    const next = run(state, event(state, 2));
    expect(next.stepIndex).toBe(3);
    expect(next.satisfied).toEqual(['heat']);
    expect(next.advancedBy.heat).toBe('event');
    expect(isSatisfied(next, 'heat')).toBe(true);
    expect(next.stepStartedAt).toBe((state.stepStartedAt ?? 0) + MIN_DWELL_MS);
  });

  it('waits for the dwell: an event inside it changes nothing, and the same event a moment later does', () => {
    const state = atStep(2);
    expect(run(state, event(state, 2, MIN_DWELL_MS - 1))).toBe(state);
    expect(run(state, event(state, 2, MIN_DWELL_MS)).stepIndex).toBe(3);
  });

  it('is only for the current step', () => {
    const state = atStep(2);
    expect(run(state, event(state, 4))).toBe(state);
    expect(run(state, event(state, 1))).toBe(state);
  });

  it('moves one step for two events in one tick', () => {
    const state = atStep(2);
    const twice = run(state, event(state, 2), {
      type: 'event-satisfied',
      stepId: 'alert',
      stepIds: STEP_IDS,
      now: (state.stepStartedAt ?? 0) + MIN_DWELL_MS,
    });
    // the second is for step 3, which came on screen at the same instant: the dwell has not passed
    expect(twice.stepIndex).toBe(3);
    expect(twice.satisfied).toEqual(['heat']);
  });

  it('does nothing for a step that is already satisfied', () => {
    const state = atStep(2);
    const next = run(state, event(state, 2));
    const back = run(next, { type: 'back', now: 50_000 });
    expect(back.stepIndex).toBe(2);
    expect(run(back, { ...event(back, 2) })).toBe(back);
  });

  it('on the last step marks it satisfied and stays, so the presenter finishes it', () => {
    const state = atStep(5);
    const done = run(state, event(state, 5));
    expect(done.stepIndex).toBe(5);
    expect(done.status).toBe('presenting');
    expect(done.satisfied).toEqual(['recover']);
  });

  it('is ignored while the presenter has exited', () => {
    const state = run(atStep(2), { type: 'exit' });
    expect(run(state, event(state, 2))).toBe(state);
  });
});

describe('back then forward', () => {
  it('a step that was satisfied stays satisfied, and going on again is by hand and instant', () => {
    let state = started(1_000);
    state = run(state, { type: 'next', now: 1_100 }, { type: 'next', now: 1_200 });
    state = run(state, event(state, 2));
    expect(state.stepIndex).toBe(3);
    state = run(state, { type: 'back', now: 20_000 });
    expect(state.stepIndex).toBe(2);
    expect(isSatisfied(state, 'heat')).toBe(true);
    state = run(state, { type: 'next', stepId: 'heat', now: 20_001 });
    expect(state.stepIndex).toBe(3);
    expect(state.satisfied).toEqual(['heat']);
  });
});

describe('enter and restart-step', () => {
  it('records the entry once, with its baseline', () => {
    const entered = run(started(), { type: 'enter', stepId: 'heat', baseline: baseline(4) });
    expect(entered.entered).toEqual(['heat']);
    expect(entered.baselines.heat).toEqual(baseline(4));
    expect(run(entered, { type: 'enter', stepId: 'heat', baseline: baseline(9) })).toBe(entered);
  });

  it('restart-step takes a new baseline, forgets that the step was satisfied and starts its dwell again', () => {
    let state = started(1_000);
    state = run(state, { type: 'next', now: 1_100 }, { type: 'next', now: 1_200 });
    state = run(state, { type: 'enter', stepId: 'heat', baseline: baseline(1) });
    state = run(state, event(state, 2));
    state = run(state, { type: 'back', now: 9_000 });
    const restarted = run(state, {
      type: 'restart-step',
      stepId: 'heat',
      baseline: baseline(8),
      now: 10_000,
    });
    expect(restarted.satisfied).toEqual([]);
    expect(restarted.baselines.heat).toEqual(baseline(8));
    expect(restarted.stepStartedAt).toBe(10_000);
    expect(restarted.entered).toEqual(['heat']);
  });

  it('restart-step on a step that was never entered enters it', () => {
    const state = run(started(), {
      type: 'restart-step',
      stepId: 'normal',
      baseline: baseline(2),
      now: 5_000,
    });
    expect(state.entered).toEqual(['normal']);
  });
});

describe('exit, resume and finish', () => {
  it('exit keeps the step, the entries and the holds; resume returns to it', () => {
    const hold = { deviceId: 'dc-env-01', metric: 'temperature_c' };
    let state = started();
    state = run(
      state,
      { type: 'enter', stepId: 'normal', baseline: baseline() },
      { type: 'next', now: 2_000 },
      { type: 'track-hold', hold },
    );
    const exited = run(state, { type: 'exit' });
    expect(exited.status).toBe('paused-for-exit');
    expect(exited).toMatchObject({ stepIndex: 1, entered: ['normal'], holds: [hold] });
    expect(isActive(exited)).toBe(true);

    const back = run(exited, { type: 'resume', now: 60_000 });
    expect(back).toMatchObject({ status: 'presenting', stepIndex: 1, stepStartedAt: 60_000 });
  });

  it('exit and resume do nothing in the wrong state', () => {
    expect(run(INITIAL_SESSION, { type: 'exit' })).toBe(INITIAL_SESSION);
    const presenting = started();
    expect(run(presenting, { type: 'resume', now: 5 })).toBe(presenting);
  });

  it('finish ends a demo that was started, and not one that was not', () => {
    expect(run(started(), { type: 'finish' }).status).toBe('finished');
    expect(run(INITIAL_SESSION, { type: 'finish' })).toBe(INITIAL_SESSION);
    expect(isActive(run(started(), { type: 'finish' }))).toBe(false);
  });

  it('reset forgets everything', () => {
    expect(run(started(), { type: 'reset' })).toBe(INITIAL_SESSION);
  });
});

describe('holds', () => {
  const hold = { deviceId: 'dc-env-01', metric: 'temperature_c' };

  it('tracks a hold once and releases them all', () => {
    const tracked = run(started(), { type: 'track-hold', hold });
    expect(run(tracked, { type: 'track-hold', hold })).toBe(tracked);
    expect(tracked.holds).toEqual([hold]);
    const two = run(tracked, { type: 'track-hold', hold: { ...hold, metric: 'humidity_pct' } });
    expect(two.holds).toHaveLength(2);
    expect(run(two, { type: 'release-holds' }).holds).toEqual([]);
    expect(run(INITIAL_SESSION, { type: 'release-holds' })).toBe(INITIAL_SESSION);
  });

  it('finish keeps the holds for the page to release', () => {
    expect(run(started(), { type: 'track-hold', hold }, { type: 'finish' }).holds).toEqual([hold]);
  });
});

describe('the run clock', () => {
  it('is zero before the demo starts and counts from the start', () => {
    expect(elapsedMs(INITIAL_SESSION, 99_000)).toBe(0);
    expect(elapsedMs(started(1_000), 4_000)).toBe(3_000);
  });

  it('does not count the time the engine was stopped, nor grow while it is', () => {
    let state = started(0);
    state = run(state, { type: 'engine', running: false, now: 10_000 });
    expect(elapsedMs(state, 25_000)).toBe(10_000);
    state = run(state, { type: 'engine', running: true, now: 30_000 });
    expect(elapsedMs(state, 40_000)).toBe(10_000 + 10_000);
  });

  it('ignores a repeated report of the same engine state', () => {
    const stopped = run(started(0), { type: 'engine', running: false, now: 10_000 });
    expect(run(stopped, { type: 'engine', running: false, now: 20_000 })).toBe(stopped);
    expect(run(started(0), { type: 'engine', running: true, now: 5 })).toMatchObject({
      stoppedSince: null,
      stoppedMs: 0,
    });
  });

  it('ignores the engine before a demo has started', () => {
    expect(run(INITIAL_SESSION, { type: 'engine', running: false, now: 5 })).toBe(INITIAL_SESSION);
  });

  it('formats minutes and seconds, and hours when there are any', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(168_000)).toBe('02:48');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(-5)).toBe('00:00');
  });
});

describe('stepStanding', () => {
  it('draws done, current and upcoming around the current step, and every step done when finished', () => {
    const state = run(started(), { type: 'next', now: 2 }, { type: 'next', now: 3 });
    expect([0, 1, 2, 3, 4, 5].map((i) => stepStanding(state, i))).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
    const finished = run(state, { type: 'finish' });
    expect([0, 5].map((i) => stepStanding(finished, i))).toEqual(['done', 'done']);
  });
});

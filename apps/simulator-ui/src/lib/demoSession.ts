import type { Baseline } from './demoEvents';

/**
 * How long a step has been on screen before an awaited event may move it on by itself, in ms. On a fast stack the alert and the
 * incident follow the rule within a second or two; without this the narration of a step would flash past. `Space` and Next do not wait.
 */
export const MIN_DWELL_MS = 1500;

export type SessionStatus = 'idle' | 'presenting' | 'paused-for-exit' | 'finished';

/** A value the script holds on a device (`hold-value`); it stays until it is released. */
export interface TrackedHold {
  deviceId: string;
  metric: string;
}

export interface DemoSessionState {
  /** The script being presented, `null` while no demo was started. */
  scriptId: string | null;
  stepCount: number;
  stepIndex: number;
  status: SessionStatus;
  /** When "Start presenter" was pressed (ms), for "02:48 in". */
  startedAt: number | null;
  /** When the current step came on screen (ms): the dwell is counted from here. */
  stepStartedAt: number | null;
  /** The ids of the steps whose awaited event happened. A step the presenter moved past by hand is not in it. */
  satisfied: readonly string[];
  /** How each step that was left was left. */
  advancedBy: Readonly<Record<string, 'event' | 'manual'>>;
  /** The steps whose entry has happened (their action ran): going back to one does not run it again. */
  entered: readonly string[];
  /** Where each entered step's awaited event began to count. */
  baselines: Readonly<Record<string, Baseline>>;
  holds: readonly TrackedHold[];
  /** While the engine is not running: since when (ms). The run clock does not count that time. */
  stoppedSince: number | null;
  stoppedMs: number;
}

export const INITIAL_SESSION: DemoSessionState = {
  scriptId: null,
  stepCount: 0,
  stepIndex: 0,
  status: 'idle',
  startedAt: null,
  stepStartedAt: null,
  satisfied: [],
  advancedBy: {},
  entered: [],
  baselines: {},
  holds: [],
  stoppedSince: null,
  stoppedMs: 0,
};

export type DemoSessionAction =
  | { type: 'start'; scriptId: string; stepCount: number; now: number }
  /** A manual move to the next step (`stepId` is the one being left); on the last step it finishes the demo. */
  | { type: 'next'; stepId?: string; now: number }
  | { type: 'back'; now: number }
  /** The awaited event of the step `stepId` happened. Ignored unless it is the current step and the dwell is over. */
  | { type: 'event-satisfied'; stepId: string; stepIds: readonly string[]; now: number }
  /** The step's entry has happened: its action ran (or it has none) and its baseline was taken. */
  | { type: 'enter'; stepId: string; baseline: Baseline }
  /** Restart the step: its wait begins again from a new baseline. */
  | { type: 'restart-step'; stepId: string; baseline: Baseline; now: number }
  | { type: 'exit' }
  | { type: 'resume'; now: number }
  | { type: 'finish' }
  | { type: 'track-hold'; hold: TrackedHold }
  | { type: 'release-holds' }
  | { type: 'engine'; running: boolean; now: number }
  /** Forget the session (the demo was stopped from the start screen). */
  | { type: 'reset' };

const sameHold = (a: TrackedHold, b: TrackedHold) =>
  a.deviceId === b.deviceId && a.metric === b.metric;

const leave = (
  state: DemoSessionState,
  stepId: string | undefined,
  how: 'event' | 'manual',
): Pick<DemoSessionState, 'advancedBy'> => ({
  advancedBy: stepId === undefined ? state.advancedBy : { ...state.advancedBy, [stepId]: how },
});

/**
 * The demo's state machine. Pure: a time is an argument, never read here. It moves the current step; it starts and stops nothing (the
 * driver does that), and `exit` leaves everything running.
 *
 * - **next** is the presenter's: always allowed, however the step stands. On the last step it finishes.
 * - **event-satisfied** is the stack's: only for the current step, only after the dwell, one step at a time, and never past the last
 *   step (the presenter finishes the demo, so the last step stays on screen).
 * - **back** shows the step before and undoes nothing; a step that was satisfied stays satisfied.
 */
export function demoSessionReducer(
  state: DemoSessionState,
  action: DemoSessionAction,
): DemoSessionState {
  switch (action.type) {
    case 'start':
      if (action.stepCount < 1) return state;
      return {
        ...INITIAL_SESSION,
        scriptId: action.scriptId,
        stepCount: action.stepCount,
        status: 'presenting',
        startedAt: action.now,
        stepStartedAt: action.now,
        holds: state.holds,
      };

    case 'next': {
      if (state.status !== 'presenting') return state;
      if (state.stepIndex >= state.stepCount - 1) return { ...state, status: 'finished' };
      return {
        ...state,
        ...leave(state, action.stepId, 'manual'),
        stepIndex: state.stepIndex + 1,
        stepStartedAt: action.now,
      };
    }

    case 'back': {
      if (state.status !== 'presenting' || state.stepIndex === 0) return state;
      return { ...state, stepIndex: state.stepIndex - 1, stepStartedAt: action.now };
    }

    case 'event-satisfied': {
      if (state.status !== 'presenting') return state;
      if (action.stepIds[state.stepIndex] !== action.stepId) return state;
      if (state.satisfied.includes(action.stepId)) return state;
      if (state.stepStartedAt !== null && action.now - state.stepStartedAt < MIN_DWELL_MS) {
        return state;
      }
      const satisfied = [...state.satisfied, action.stepId];
      if (state.stepIndex >= state.stepCount - 1) return { ...state, satisfied };
      return {
        ...state,
        satisfied,
        ...leave(state, action.stepId, 'event'),
        stepIndex: state.stepIndex + 1,
        stepStartedAt: action.now,
      };
    }

    case 'enter': {
      if (state.entered.includes(action.stepId)) return state;
      return {
        ...state,
        entered: [...state.entered, action.stepId],
        baselines: { ...state.baselines, [action.stepId]: action.baseline },
      };
    }

    case 'restart-step':
      return {
        ...state,
        satisfied: state.satisfied.filter((id) => id !== action.stepId),
        entered: state.entered.includes(action.stepId)
          ? state.entered
          : [...state.entered, action.stepId],
        baselines: { ...state.baselines, [action.stepId]: action.baseline },
        stepStartedAt: action.now,
      };

    case 'exit':
      return state.status === 'presenting' ? { ...state, status: 'paused-for-exit' } : state;

    case 'resume':
      return state.status === 'paused-for-exit'
        ? { ...state, status: 'presenting', stepStartedAt: action.now }
        : state;

    case 'finish':
      return state.status === 'idle' ? state : { ...state, status: 'finished' };

    case 'track-hold':
      return state.holds.some((hold) => sameHold(hold, action.hold))
        ? state
        : { ...state, holds: [...state.holds, action.hold] };

    case 'release-holds':
      return state.holds.length === 0 ? state : { ...state, holds: [] };

    case 'engine': {
      if (state.startedAt === null) return state;
      if (!action.running) {
        return state.stoppedSince === null ? { ...state, stoppedSince: action.now } : state;
      }
      if (state.stoppedSince === null) return state;
      return {
        ...state,
        stoppedSince: null,
        stoppedMs: state.stoppedMs + Math.max(0, action.now - state.stoppedSince),
      };
    }

    case 'reset':
      return INITIAL_SESSION;
  }
}

/** Milliseconds since "Start presenter", not counting the time the engine was stopped. `0` before the demo started. */
export function elapsedMs(state: DemoSessionState, now: number): number {
  if (state.startedAt === null) return 0;
  const until = state.stoppedSince ?? now;
  return Math.max(0, until - state.startedAt - state.stoppedMs);
}

/** `02:48`; an hour or more is `1:02:48`. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

export type StepStanding = 'done' | 'current' | 'upcoming';

/** How the step list draws step `index`: behind the current one, the current one, or ahead. A finished demo has every step done. */
export function stepStanding(state: DemoSessionState, index: number): StepStanding {
  if (state.status === 'finished' || index < state.stepIndex) return 'done';
  return index === state.stepIndex ? 'current' : 'upcoming';
}

/** Whether the awaited event of a step has already happened, for the card's "already happened" line after a Back. */
export const isSatisfied = (state: DemoSessionState, stepId: string): boolean =>
  state.satisfied.includes(stepId);

/** Whether the demo is on screen's side of things: started, and not finished or reset. */
export const isActive = (state: DemoSessionState): boolean =>
  state.status === 'presenting' || state.status === 'paused-for-exit';

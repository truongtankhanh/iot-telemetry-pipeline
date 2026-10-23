/**
 * What the tests of the guided demo share: a stack that is healthy (wall clock, every device running), a fake simulator behind
 * `fetch` that adds the routes the demo uses on top of the Scenarios page's (holds, pausing and starting a device), builders for the
 * readings and observations the steps wait for, and a harness that gives a hook or the page its store, history, observation log and
 * demo session. Not a `*.test.tsx`, so Vitest does not run it as a test file.
 */
import {
  act,
  render,
  renderHook,
  type RenderHookResult,
  type RenderResult,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type {
  ObservationEvent,
  ObservationKind,
  PublishedMessage,
  ScenarioLibraryView,
  StateView,
} from '../../api/types';
import { StudioFrame } from '../../App';
import type { DemoScript } from '../../lib/demoScript';
import { OVERHEAT_TO_INCIDENT } from '../../lib/demoScripts';
import { DemoSessionStore } from '../../state/demoSessionStore';
import { HistoryStore } from '../../state/history';
import { ObservationLog } from '../../state/observationLog';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import {
  fakeScenariosSimulator,
  type FakeScenariosSimulator,
  fixtureLibrary,
} from '../scenarios/scenariosTestSupport';
import { type DemoDriver, useDemoDriver } from './useDemoDriver';

/** Where the tests' clock starts. */
export const T0 = Date.parse('2026-10-23T09:00:00.000Z');

/** The fixture's stack on the wall clock with every device running: nothing for the demo to complain about. */
export function healthyView(change: (view: StateView) => void = () => {}): StateView {
  const view = structuredClone(stateViewFixture);
  view.engine.simulated = false;
  view.engine.running = true;
  view.engine.devices = view.engine.devices.map((device) => ({ ...device, state: 'running' }));
  view.alerts = { alerts: [], lastOkAt: null, stale: false };
  change(view);
  return view;
}

/** A device's temperature reading `atMs` into the tests' clock (the payload's `ts` is what the history orders by). */
export function reading(
  deviceId: string,
  atMs: number,
  temperature: number,
  id = atMs,
): PublishedMessage {
  const ts = new Date(atMs).toISOString();
  return {
    id,
    at: ts,
    ackMs: 3,
    deviceId,
    topic: `campus/BLD-DC/${deviceId}/telemetry`,
    payload: JSON.stringify({ seq: id, ts, metrics: { temperature_c: temperature } }),
    seq: id,
    ts,
  };
}

/** An observation of the simulator, `id` seconds after the tests' clock started. */
export function observation(
  id: number,
  kind: ObservationKind,
  data: Record<string, unknown>,
): ObservationEvent {
  return { id, at: new Date(T0 + id * 1000).toISOString(), kind, data };
}

const SUBJECT = { deviceId: 'dc-env-01', ruleId: 'server-room-hot' };
export const alertOpened = (id: number, alertId = '7') =>
  observation(id, 'alert-opened', { alertId, ...SUBJECT, metric: 'temperature_c' });
export const alertCleared = (id: number, alertId = '7') =>
  observation(id, 'alert-cleared', { alertId, ...SUBJECT });
export const incidentDelivered = (id: number, alertId = '7') =>
  observation(id, 'incident', { alertId, externalRef: 'c3a1f0d2' });

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export interface FakeDemoSimulator extends FakeScenariosSimulator {
  /** Make the next `PUT` of a hold answer with a refusal, or `null` for normal service again. */
  failHold(error: { status: number; message: string } | null): void;
}

/** The Scenarios page's fake simulator, with the routes the demo adds: holds and pausing or starting a device. */
export function fakeDemoSimulator(
  state: StateView,
  library: ScenarioLibraryView = fixtureLibrary(),
): FakeDemoSimulator {
  const base = fakeScenariosSimulator(state, library);
  // `base.fetch` is replaced below by the wrapper, which hands what it does not know back to the Scenarios page's fake: keep that one.
  const baseFetch = base.fetch as (url: string, init?: RequestInit) => Promise<Response>;
  let holdFailure: { status: number; message: string } | null = null;

  const send = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url, 'http://localhost').pathname;
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as { value?: number }) : {};

    const hold = /^\/api\/devices\/([^/]+)\/holds\/([^/]+)$/.exec(path);
    if (hold && (method === 'PUT' || method === 'DELETE')) {
      base.calls.push({ method, path, body });
      if (method === 'PUT' && holdFailure) {
        return respond(holdFailure.status, {
          statusCode: holdFailure.status,
          error: 'Refused',
          message: holdFailure.message,
        });
      }
      const deviceId = decodeURIComponent(hold[1] as string);
      const metric = decodeURIComponent(hold[2] as string);
      base.state = {
        ...base.state,
        engine: {
          ...base.state.engine,
          devices: base.state.engine.devices.map((device) => {
            if (device.id !== deviceId) return device;
            const holds = { ...device.holds } as Record<string, number>;
            if (method === 'PUT') holds[metric] = body.value as number;
            else delete holds[metric];
            return { ...device, holds };
          }),
        },
      };
      return respond(200, base.state);
    }

    const device = /^\/api\/devices\/([^/]+)\/(pause|start)$/.exec(path);
    if (device && method === 'POST') {
      base.calls.push({ method, path, body: undefined });
      const deviceId = decodeURIComponent(device[1] as string);
      const next = device[2] === 'pause' ? ('paused' as const) : ('running' as const);
      base.state = {
        ...base.state,
        engine: {
          ...base.state.engine,
          devices: base.state.engine.devices.map((entry) =>
            entry.id === deviceId ? { ...entry, state: next } : entry,
          ),
        },
      };
      return respond(200, base.state);
    }

    return baseFetch(url, init);
  });

  return Object.assign(base, {
    fetch: send,
    failHold: (error: { status: number; message: string } | null) => {
      holdFailure = error;
    },
  });
}

export interface DemoHarness {
  store: StudioStore;
  history: HistoryStore;
  observations: ObservationLog;
  demo: DemoSessionStore;
  simulator: FakeDemoSimulator;
  /** Wraps children in the providers the demo reads. */
  wrapper: (props: { children: ReactNode }) => ReactNode;
  /** Puts these observations in the log, as the stream would, and tells the readers at once. */
  emit(...events: ObservationEvent[]): void;
  /** Records these readings of `dc-env-01` and tells the readers (the history notifies every 20 ms here). */
  readings(...temperatures: number[]): void;
}

export interface HarnessOptions {
  view?: StateView;
  library?: ScenarioLibraryView;
  link?: LinkState;
}

/** A store, a history, an observation log and a demo session with a fake simulator behind `fetch`. Fake timers must be on. */
export function createDemoHarness(options: HarnessOptions = {}): DemoHarness {
  const view = options.view ?? healthyView();
  const simulator = fakeDemoSimulator(structuredClone(view), options.library ?? fixtureLibrary());
  vi.stubGlobal('fetch', simulator.fetch);

  const store = createStudioStore();
  store.getState().setLink(options.link ?? 'live', Date.now());
  store.getState().setView(structuredClone(view), Date.now());
  const history = new HistoryStore({ notifyEveryMs: 20 });
  const observations = new ObservationLog({ notifyEveryMs: 20 });
  const demo = new DemoSessionStore();

  let nextReading = 1;
  return {
    store,
    history,
    observations,
    demo,
    simulator,
    wrapper: ({ children }) => (
      <StudioProvider store={store} history={history} observations={observations} demo={demo}>
        {children}
      </StudioProvider>
    ),
    emit: (...events) => {
      act(() => observations.seed(events));
    },
    readings: (...temperatures) => {
      act(() => {
        for (const temperature of temperatures) {
          const id = nextReading++;
          history.record(reading('dc-env-01', Date.now() + id, temperature, 1_000 + id));
        }
      });
    },
  };
}

/** Lets the timers and the promises that are due run: `ms` of the fake clock, with the requests the steps make answered. */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The driver of a script in a harness. */
export function renderDemoDriver(
  harness: DemoHarness,
  script: DemoScript = OVERHEAT_TO_INCIDENT,
): RenderHookResult<DemoDriver, unknown> {
  return renderHook(() => useDemoDriver(script), { wrapper: harness.wrapper });
}

/** Starts the demo at `now` and runs the clock until the first step has been entered. */
export async function startDemo(harness: DemoHarness, script: DemoScript = OVERHEAT_TO_INCIDENT) {
  act(() =>
    harness.demo.dispatch({
      type: 'start',
      scriptId: script.id,
      stepCount: script.steps.length,
      now: Date.now(),
    }),
  );
  await advance(50);
}

/** The presenter moves on by hand `times` times (each step is entered, its action done, before the next). */
export async function nextStep(harness: DemoHarness, times = 1) {
  for (let i = 0; i < times; i++) {
    act(() => harness.demo.dispatch({ type: 'next', now: Date.now() }));
    await advance(50);
  }
}

/** The page the way a person meets it: inside the shell (so presenter mode swaps the header and drops the navigation), at `path`. */
export function renderDemo(harness: DemoHarness, path = '/demo'): RenderResult {
  return render(
    <harness.wrapper>
      <MemoryRouter initialEntries={[path]}>
        <StudioFrame />
      </MemoryRouter>
    </harness.wrapper>,
  );
}

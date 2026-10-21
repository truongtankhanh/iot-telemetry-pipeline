/**
 * What the tests of the Overview share: the fake simulator of the Scenarios page (state, library, run, stop) with the
 * rest of what the Overview asks for added to it (Step and Reset, the devices' Pause and Start, the observation log),
 * and a render that puts the page in a router, a store, a history and an observation log. Not a `*.test.tsx`, so Vitest
 * does not run it as a test file. The Scenarios', Fleet's and Topology's support files are not changed.
 */
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { ObservationEvent, ScenarioLibraryView, StateView } from '../../api/types';
import { AnimationBudget } from '../../lib/animationBudget';
import { HistoryStore } from '../../state/history';
import { ObservationLog } from '../../state/observationLog';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { AnimationBudgetProvider } from '../../ui/AnimationBudget';
import { AddressProbe } from '../fleet/AddressProbe';
import { seedHistory } from '../fleet/fleetTestSupport';
import {
  type Call,
  fakeScenariosSimulator,
  type FakeScenariosSimulator,
  fixtureLibrary,
} from '../scenarios/scenariosTestSupport';
import { Overview } from '../Overview';

export { address } from '../fleet/fleetTestSupport';
export { fixtureLibrary, scenarioItem } from '../scenarios/scenariosTestSupport';

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const envelope = (status: number, error: string, message: string) => ({
  statusCode: status,
  error,
  message,
});

/** `count` observations, ids 1 to `count`, one a minute ending at `endMs`, of kinds that cycle through the sources. */
export function observations(count: number, endMs = Date.now()): ObservationEvent[] {
  const kinds: ObservationEvent['kind'][] = [
    'engine-state',
    'scenario-run',
    'alert-opened',
    'delivery',
    'incident',
    'alert-cleared',
  ];
  return Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length] as ObservationEvent['kind'];
    return {
      id: i + 1,
      at: new Date(endMs - (count - 1 - i) * 60_000).toISOString(),
      kind,
      data:
        kind === 'engine-state'
          ? { type: 'device-state', deviceId: 'stu-air-01', state: 'paused' }
          : kind === 'scenario-run'
            ? { name: 'server-room-overheat', runId: 'r1', anomalyIds: ['a1'], anomalies: [] }
            : { alertId: '7', deviceId: 'dc-env-01', ruleId: 'server-room-hot', title: 'Hot' },
    };
  });
}

export interface FakeOverviewSimulator extends FakeScenariosSimulator {
  /** Every observation the simulator holds, oldest first. */
  events: ObservationEvent[];
}

/** The simulator, as `fetch` sees it, for everything the Overview asks. */
export function fakeOverviewSimulator(
  state: StateView,
  library: ScenarioLibraryView,
  events: ObservationEvent[] = [],
): FakeOverviewSimulator {
  const base = fakeScenariosSimulator(state, library);
  const extra: Call[] = [];

  const setDevice = (id: string, to: 'running' | 'paused' | 'stopped') => {
    base.state = {
      ...base.state,
      engine: {
        ...base.state.engine,
        devices: base.state.engine.devices.map((d) => (d.id === id ? { ...d, state: to } : d)),
      },
    };
    return respond(200, base.state);
  };

  const send = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const parsed = new URL(url, 'http://localhost');
    const path = parsed.pathname;

    if (method === 'GET' && path === '/api/observations') {
      const before = Number(parsed.searchParams.get('before') ?? Infinity);
      const limit = Number(parsed.searchParams.get('limit') ?? 100);
      const older = sim.events.filter((e) => e.id < before);
      const page = older.slice(-limit).reverse();
      const oldest = page.at(-1);
      const more = oldest !== undefined && older.length > page.length;
      extra.push({ method, path, body: undefined });
      return respond(200, page, more ? { 'X-Next-Cursor': String(oldest.id) } : {});
    }
    if (method === 'POST' && path === '/api/step') {
      extra.push({ method, path, body: undefined });
      if (!base.state.engine.simulated) {
        return respond(
          409,
          envelope(
            409,
            'Conflict',
            'step needs the simulated clock; this engine runs on the wall clock',
          ),
        );
      }
      base.state = {
        ...base.state,
        engine: {
          ...base.state.engine,
          elapsedS: base.state.engine.elapsedS + base.state.engine.intervalMs / 1000,
          nowMs: base.state.engine.nowMs + base.state.engine.intervalMs,
        },
      };
      return respond(200, base.state);
    }
    if (method === 'POST' && path === '/api/reset') {
      extra.push({ method, path, body: undefined });
      base.state = {
        ...base.state,
        runs: [],
        engine: { ...base.state.engine, anomalies: [] },
      };
      return respond(200, base.state);
    }
    const device = /^\/api\/devices\/([^/]+)\/(pause|start|stop)$/.exec(path);
    if (method === 'POST' && device) {
      extra.push({ method, path, body: undefined });
      const to = { pause: 'paused', start: 'running', stop: 'stopped' } as const;
      return setDevice(decodeURIComponent(device[1] as string), to[device[2] as keyof typeof to]);
    }
    return (base.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>)(
      url,
      init,
    );
  });

  const sim: FakeOverviewSimulator = {
    ...base,
    events,
    callsTo: (method, path) =>
      [...base.calls, ...extra].filter((c) => c.method === method && c.path === path),
    fetch: send,
  };
  // The base fake reassigns `state` and `library`; read them through it.
  Object.defineProperty(sim, 'state', { get: () => base.state, set: (v) => (base.state = v) });
  Object.defineProperty(sim, 'library', {
    get: () => base.library,
    set: (v) => (base.library = v),
  });
  return sim;
}

export interface RenderOverviewOptions {
  /** The address to open (`/?scenario=bad-afternoon`). */
  path?: string;
  /** The state the store holds; `null` is a page before its first message. */
  view?: StateView | null;
  /** Run the engine on the stepped clock (the fixture is a stepped engine); the wall clock by default. */
  simulated?: boolean;
  library?: ScenarioLibraryView;
  link?: LinkState;
  /** Fill the history with readings (default). */
  seed?: boolean;
  /** The observations the simulator holds; the log is filled from them as it is by the stream. */
  events?: ObservationEvent[];
  /** The library read fails from the start. */
  libraryFailure?: { status: number; message: string };
}

export type OverviewHarness = RenderResult & {
  store: StudioStore;
  history: HistoryStore;
  log: ObservationLog;
  simulator: FakeOverviewSimulator;
};

/** The Overview at `/` in a router, a store, a history and a log, with `fetch` replaced by the fake simulator. */
export function renderOverview(options: RenderOverviewOptions = {}): OverviewHarness {
  const { path = '/', link = 'live', seed = true, simulated = false } = options;
  let view = options.view === undefined ? structuredClone(stateViewFixture) : options.view;
  if (view !== null) {
    view = structuredClone(view);
    view.engine.simulated = simulated;
    view.config.simulated = simulated;
    // On the wall clock the scenario's seconds are counted from the snapshot, which was taken just now.
    if (!simulated) view.engine.nowMs = Date.now();
  }
  const simulator = fakeOverviewSimulator(
    structuredClone(view ?? stateViewFixture),
    options.library ?? fixtureLibrary(),
    options.events ?? [],
  );
  if (options.libraryFailure) simulator.failLibrary(options.libraryFailure);
  vi.stubGlobal('fetch', simulator.fetch);

  const store = createStudioStore();
  store.getState().setLink(link, Date.now());
  if (view) store.getState().setView(structuredClone(view), Date.now());
  const history = new HistoryStore();
  if (view && seed) seedHistory(history, view);
  const log = new ObservationLog();
  log.seed(simulator.events);

  const result = render(
    <StudioProvider store={store} history={history} observations={log}>
      <AnimationBudgetProvider budget={new AnimationBudget()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/" element={<Overview />} />
          </Routes>
          <AddressProbe />
        </MemoryRouter>
      </AnimationBudgetProvider>
    </StudioProvider>,
  );
  return { ...result, store, history, log, simulator };
}

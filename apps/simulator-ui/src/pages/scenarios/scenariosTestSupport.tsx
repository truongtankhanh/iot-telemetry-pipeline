/**
 * What the tests of the Scenarios page share: a fake simulator behind `fetch` that serves `/api/state` and the library,
 * runs, stops and imports scenarios the way the real one answers (a `409` with its conflicts until the run asks to
 * replace, a refusal with the reason for an import that is out of range), a few builders, and a render that puts the page
 * in a router and a provider. Not a `*.test.tsx`, so Vitest does not run it as a test file. The Fleet's and the Alerts'
 * support files are not changed.
 */
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import scenariosFixture from '../../api/fixtures/scenarios.json';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { RunConflict, ScenarioItem, ScenarioLibraryView, StateView } from '../../api/types';
import type { BenchmarkStore } from '../../state/benchmarkStore';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { AddressProbe } from '../fleet/AddressProbe';
import { Scenarios } from './Scenarios';

export { address } from '../fleet/fleetTestSupport';

/** The library of the fixture: two built-ins, a custom scenario of three lanes that needs a stopped hub, and one rejected file. */
export const fixtureLibrary = (): ScenarioLibraryView =>
  structuredClone(scenariosFixture) as unknown as ScenarioLibraryView;

/** A scenario with plain defaults (custom, one anomaly on dc-env-01 that raises the server room alert). */
export function scenarioItem(name: string, overrides: Partial<ScenarioItem> = {}): ScenarioItem {
  const [overheat] = fixtureLibrary().scenarios as [ScenarioItem];
  return {
    ...overheat,
    name,
    description: `The scenario ${name}.`,
    source: 'custom',
    ...overrides,
  };
}

/** 2 built-in and 36 custom scenarios, as in the ticket: 38 in all, in that order. */
export function library38(): ScenarioLibraryView {
  const [overheat, lecture] = fixtureLibrary().scenarios as [ScenarioItem, ScenarioItem];
  return {
    scenarios: [
      overheat,
      lecture,
      ...Array.from({ length: 36 }, (_, i) =>
        scenarioItem(`custom-${String(i + 1).padStart(2, '0')}`),
      ),
    ],
    rejected: [],
    intervalMs: 2000,
  };
}

/** A scenario file the page can be given: `text()` is written out because the test environment may not provide it. */
export function jsonFile(name: string, content: string): File {
  const file = new File([content], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  return file;
}

const envelope = (status: number, error: string, message: string, extra: object = {}) => ({
  statusCode: status,
  error,
  message,
  ...extra,
});

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeScenariosSimulator {
  /** Every request made, in order. */
  calls: Call[];
  callsTo(method: string, path: string): Call[];
  /** The library the simulator holds now (a run, a stop and an import change it). */
  library: ScenarioLibraryView;
  state: StateView;
  /** Refuse a run of this scenario with these conflicts until the run asks to replace. */
  conflicts: Map<string, RunConflict[]>;
  /** Make `GET /api/scenarios` answer with an error, or `null` for normal service again. */
  failLibrary(error: { status: number; message: string } | null): void;
  /** Make every run answer with a refusal, or `null` for normal service again. */
  failRun(error: { status: number; message: string } | null): void;
  /** Make every `DELETE` of a scenario answer with a refusal, or `null` for normal service again. */
  failDelete(error: { status: number; message: string } | null): void;
  fetch: ReturnType<typeof vi.fn>;
}

/** The simulator, as `fetch` sees it. */
export function fakeScenariosSimulator(
  state: StateView,
  library: ScenarioLibraryView,
): FakeScenariosSimulator {
  const calls: Call[] = [];
  const conflicts = new Map<string, RunConflict[]>();
  let libraryFailure: { status: number; message: string } | null = null;
  let runFailure: { status: number; message: string } | null = null;
  let deleteFailure: { status: number; message: string } | null = null;
  let nextRun = 1;

  const find = (name: string) => sim.library.scenarios.find((s) => s.name === name);

  const run = (name: string, body: { replace?: boolean }) => {
    const item = find(name);
    if (!item) return respond(404, envelope(404, 'Not Found', `Unknown scenario "${name}"`));
    if (runFailure)
      return respond(
        runFailure.status,
        envelope(runFailure.status, 'Bad Request', runFailure.message),
      );
    const blocking = conflicts.get(name);
    if (blocking && !body.replace) {
      return respond(
        409,
        envelope(
          409,
          'Conflict',
          `"${name}" would play over an anomaly that is active or coming; run it with replace to remove it`,
          { conflicts: blocking },
        ),
      );
    }
    const replaced = blocking
      ? [...new Set(blocking.map((c) => c.runId))].map((runId) => ({
          runId,
          scenario: blocking.find((c) => c.runId === runId)?.scenario ?? null,
          anomalyIds: blocking.filter((c) => c.runId === runId).map((c) => c.anomalyId),
        }))
      : [];
    conflicts.delete(name);
    const startedDevices = item.needsStart.map((need) => need.deviceId);
    const id = `r${nextRun++}`;
    sim.state = {
      ...sim.state,
      runs: [
        ...sim.state.runs,
        {
          id,
          scenario: name,
          startedAt: '2026-10-21T09:00:00.000Z',
          offsetS: sim.state.engine.elapsedS,
          endsAtS: sim.state.engine.elapsedS + item.lengthS,
          anomalyIds: ['a1'],
          startedDevices,
        },
      ],
      engine: {
        ...sim.state.engine,
        devices: sim.state.engine.devices.map((d) =>
          startedDevices.includes(d.id) ? { ...d, state: 'running' as const } : d,
        ),
      },
    };
    item.running = true;
    item.lastRunAt = '2026-10-21T09:00:00.000Z';
    item.needsStart = [];
    return respond(200, { ...sim.state, runId: id, anomalyIds: ['a1'], startedDevices, replaced });
  };

  const stop = (name: string) => {
    const item = find(name);
    if (!item) return respond(404, envelope(404, 'Not Found', `Unknown scenario "${name}"`));
    if (!sim.state.runs.some((r) => r.scenario === name)) {
      return respond(409, envelope(409, 'Conflict', `"${name}" is not running`));
    }
    sim.state = { ...sim.state, runs: sim.state.runs.filter((r) => r.scenario !== name) };
    item.running = false;
    return respond(200, sim.state);
  };

  const importScenario = (body: unknown) => {
    const doc = body as {
      name?: string;
      description?: string;
      anomalies?: ScenarioItem['anomalies'];
    };
    if (sim.library.scenarios.some((s) => s.name === doc.name)) {
      return respond(
        409,
        envelope(409, 'Conflict', `a scenario named "${doc.name}" already exists`),
      );
    }
    const bad = (doc.anomalies ?? []).findIndex(
      (a) => a.metric === 'temperature_c' && a.value > 85,
    );
    if (bad >= 0) {
      const value = doc.anomalies?.[bad]?.value;
      return respond(
        400,
        envelope(
          400,
          'Bad Request',
          `anomalies[${bad}].value ${value} is outside the range of temperature_c (-40 to 85 °C)`,
        ),
      );
    }
    const item = scenarioItem(doc.name ?? 'imported', {
      description: doc.description ?? '',
      anomalies: doc.anomalies ?? [],
      imported: true,
    });
    sim.library = { ...sim.library, scenarios: [...sim.library.scenarios, item] };
    return respond(201, { ...sim.state, scenario: item });
  };

  const remove = (name: string) => {
    if (deleteFailure) {
      return respond(
        deleteFailure.status,
        envelope(deleteFailure.status, 'Refused', deleteFailure.message),
      );
    }
    const item = find(name);
    if (!item) return respond(404, envelope(404, 'Not Found', `Unknown scenario "${name}"`));
    if (item.source === 'built-in') {
      return respond(
        409,
        envelope(409, 'Conflict', `"${name}" is a built-in scenario and is read-only`),
      );
    }
    if (sim.state.runs.some((r) => r.scenario === name)) {
      return respond(409, envelope(409, 'Conflict', `"${name}" is running; stop it first`));
    }
    sim.library = {
      ...sim.library,
      scenarios: sim.library.scenarios.filter((candidate) => candidate.name !== name),
    };
    sim.state = { ...sim.state, scenarios: sim.library.scenarios.map((s) => s.name) };
    return respond(200, sim.state);
  };

  const send = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url, 'http://localhost').pathname;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path, body });

    if (method === 'GET' && path === '/api/state') return respond(200, sim.state);
    if (method === 'GET' && path === '/api/scenarios') {
      return libraryFailure
        ? respond(
            libraryFailure.status,
            envelope(libraryFailure.status, 'Bad Gateway', libraryFailure.message),
          )
        : respond(200, sim.library);
    }
    if (method === 'POST' && path === '/api/scenarios/import') return importScenario(body);
    const one = /^\/api\/scenarios\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && one) return remove(decodeURIComponent(one[1] as string));
    const command = /^\/api\/scenarios\/([^/]+)\/(run|stop)$/.exec(path);
    if (method === 'POST' && command) {
      const name = decodeURIComponent(command[1] as string);
      return command[2] === 'run' ? run(name, (body ?? {}) as { replace?: boolean }) : stop(name);
    }
    return respond(404, envelope(404, 'Not Found', `No such route: ${method} ${path}`));
  });

  const sim: FakeScenariosSimulator = {
    calls,
    callsTo: (method, path) => calls.filter((c) => c.method === method && c.path === path),
    library,
    state,
    conflicts,
    failLibrary: (error) => {
      libraryFailure = error;
    },
    failRun: (error) => {
      runFailure = error;
    },
    failDelete: (error) => {
      deleteFailure = error;
    },
    fetch: send,
  };
  return sim;
}

export interface RenderScenariosOptions {
  /** The window's benchmark; a test with a run going passes one that holds it. */
  benchmark?: BenchmarkStore;
  path?: string;
  /** The state the store holds; `null` is a page before its first message. */
  view?: StateView | null;
  library?: ScenarioLibraryView;
  link?: LinkState;
  /** The library read fails from the start. */
  libraryFailure?: { status: number; message: string };
}

export type ScenariosHarness = RenderResult & {
  store: StudioStore;
  simulator: FakeScenariosSimulator;
};

/** The Scenarios page in a router (starting at `path`) and a store, with `fetch` replaced by the fake simulator. */
export function renderScenarios(options: RenderScenariosOptions = {}): ScenariosHarness {
  const { path = '/lab/scenarios', link = 'live' } = options;
  const view = options.view === undefined ? structuredClone(stateViewFixture) : options.view;
  const simulator = fakeScenariosSimulator(
    structuredClone(view ?? stateViewFixture),
    options.library ?? fixtureLibrary(),
  );
  if (options.libraryFailure) simulator.failLibrary(options.libraryFailure);
  vi.stubGlobal('fetch', simulator.fetch);

  const store = createStudioStore();
  store.getState().setLink(link, Date.now());
  if (view) store.getState().setView(structuredClone(view), Date.now());

  const result = render(
    <StudioProvider store={store} benchmark={options.benchmark}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lab/scenarios" element={<Scenarios />} />
        </Routes>
        <AddressProbe />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { ...result, store, simulator };
}

/**
 * What the tests of the timeline editor share: the Scenarios page's fake simulator (the library, runs, stops, imports) with
 * what the editor adds to it, `PUT` and `DELETE /api/scenarios/:name` answering the way the real one does (`201` or `200`
 * with the card, `400` for a value outside the contract's range, `409` for a built-in or a scenario that runs) and
 * `POST /api/expectations` with the Lab's simple but consistent guess; and a render of a hook or of a page in a router and a
 * provider whose working copies the test owns. Not a `*.test.tsx`, so Vitest does not run it as a test file. The other
 * pages' support files are not changed.
 */
import {
  render,
  renderHook,
  type RenderHookResult,
  type RenderResult,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { Anomaly, ScenarioLibraryView, StateView } from '../../api/types';
import { EditorDrafts } from '../../state/editorDrafts';
import type { BenchmarkStore } from '../../state/benchmarkStore';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { AddressProbe } from '../fleet/AddressProbe';
import { previewFor } from '../lab/labTestSupport';
import {
  type Call,
  fakeScenariosSimulator,
  type FakeScenariosSimulator,
  fixtureLibrary,
  scenarioItem,
} from '../scenarios/scenariosTestSupport';
import { EditorPart, type PartContext } from './EditorPart';
import { Timeline } from './Timeline';

export interface Refusal {
  status: number;
  message: string;
}

export interface FakeEditorSimulator extends FakeScenariosSimulator {
  /** Make every `PUT` answer with a refusal, or `null` for normal service again. */
  failSave(refusal: Refusal | null): void;
}

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const envelope = (status: number, message: string) => ({
  statusCode: status,
  error: 'Refused',
  message,
});

/** The simulator, as `fetch` sees it, with the editor's routes added to the Scenarios page's. */
export function fakeEditorSimulator(
  state: StateView,
  library: ScenarioLibraryView,
): FakeEditorSimulator {
  const base = fakeScenariosSimulator(state, library);
  const calls: Call[] = [];
  let saveFailure: Refusal | null = null;

  const find = (name: string) => base.library.scenarios.find((item) => item.name === name);
  const names = () => base.library.scenarios.map((item) => item.name);
  const running = (name: string) => base.state.runs.some((run) => run.scenario === name);

  const save = (name: string, body: unknown) => {
    if (saveFailure)
      return respond(saveFailure.status, envelope(saveFailure.status, saveFailure.message));
    const doc = body as { name?: string; description?: string; anomalies?: Anomaly[] };
    if (doc.name !== name) {
      return respond(
        400,
        envelope(400, `"name" in the body must be "${name}", the name in the path`),
      );
    }
    const existing = find(name);
    if (existing?.source === 'built-in') {
      return respond(
        409,
        envelope(
          409,
          `"${name}" is a built-in scenario and is read-only; save a copy under another name`,
        ),
      );
    }
    if (running(name)) return respond(409, envelope(409, `"${name}" is running; stop it first`));
    const anomalies = doc.anomalies ?? [];
    const bad = anomalies.findIndex((a) => a.metric === 'temperature_c' && a.value > 85);
    if (bad >= 0) {
      return respond(
        400,
        envelope(
          400,
          `anomalies[${bad}].value ${anomalies[bad]?.value} is outside the range of temperature_c (-40 to 85 °C)`,
        ),
      );
    }
    const item = scenarioItem(name, {
      description: doc.description ?? '',
      anomalies,
      imported: false,
      running: false,
      lastRunAt: existing?.lastRunAt ?? null,
      needsStart: [],
      lengthS: Math.max(0, ...anomalies.map((a) => a.startAt + a.duration)),
      expected: previewFor(anomalies, base.state).expected,
    });
    base.library = {
      ...base.library,
      scenarios:
        existing === undefined
          ? [...base.library.scenarios, item]
          : base.library.scenarios.map((candidate) => (candidate.name === name ? item : candidate)),
    };
    base.state = { ...base.state, scenarios: names() };
    return respond(existing === undefined ? 201 : 200, { ...base.state, scenario: item });
  };

  const remove = (name: string) => {
    const existing = find(name);
    if (existing === undefined) return respond(404, envelope(404, `Unknown scenario "${name}"`));
    if (existing.source === 'built-in') {
      return respond(409, envelope(409, `"${name}" is a built-in scenario and is read-only`));
    }
    if (running(name)) return respond(409, envelope(409, `"${name}" is running; stop it first`));
    base.library = {
      ...base.library,
      scenarios: base.library.scenarios.filter((item) => item.name !== name),
    };
    base.state = { ...base.state, scenarios: names() };
    return respond(200, base.state);
  };

  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url, 'http://localhost').pathname;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path, body });

    const scenario = /^\/api\/scenarios\/([^/]+)$/.exec(path);
    if (scenario && method === 'PUT') return save(decodeURIComponent(scenario[1] as string), body);
    if (scenario && method === 'DELETE') return remove(decodeURIComponent(scenario[1] as string));
    if (method === 'POST' && path === '/api/expectations') {
      const { anomalies } = body as { anomalies: Anomaly[] };
      return respond(200, previewFor(anomalies, base.state));
    }
    return (base.fetch as (url: string, init?: RequestInit) => Promise<Response>)(url, init);
  });

  return {
    get calls() {
      return calls;
    },
    callsTo: (method, path) => calls.filter((c) => c.method === method && c.path === path),
    get library() {
      return base.library;
    },
    set library(value) {
      base.library = value;
    },
    get state() {
      return base.state;
    },
    set state(value) {
      base.state = value;
    },
    conflicts: base.conflicts,
    failLibrary: base.failLibrary,
    failRun: base.failRun,
    failDelete: base.failDelete,
    failSave: (refusal) => {
      saveFailure = refusal;
    },
    fetch,
  } as FakeEditorSimulator;
}

export interface RenderEditorOptions {
  /** The window's benchmark; a test with a run going passes one that holds it. */
  benchmark?: BenchmarkStore;
  /** The address to start at, query included. */
  path?: string;
  /** The state the store holds; `null` is a page before its first message. */
  view?: StateView | null;
  library?: ScenarioLibraryView;
  link?: LinkState;
  /** The working copies, to keep them across two renders (leaving the page and coming back). */
  drafts?: EditorDrafts;
  /** The library read fails from the start. */
  libraryFailure?: Refusal;
}

export interface EditorHarness {
  store: StudioStore;
  drafts: EditorDrafts;
  simulator: FakeEditorSimulator;
  wrapper: (props: { children: ReactNode }) => ReactNode;
}

/** The store, the working copies and the fake simulator (with `fetch` replaced by it) that a test of the editor runs on. */
export function editorHarness(options: RenderEditorOptions = {}): EditorHarness {
  const { path = '/lab/timeline', link = 'live' } = options;
  const view = options.view === undefined ? structuredClone(stateViewFixture) : options.view;
  const simulator = fakeEditorSimulator(
    structuredClone(view ?? stateViewFixture),
    options.library ?? fixtureLibrary(),
  );
  if (options.libraryFailure) simulator.failLibrary(options.libraryFailure);
  vi.stubGlobal('fetch', simulator.fetch);

  const store = createStudioStore();
  store.getState().setLink(link, Date.now());
  if (view) store.getState().setView(structuredClone(view), Date.now());
  const drafts = options.drafts ?? new EditorDrafts();

  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store} drafts={drafts} benchmark={options.benchmark}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </StudioProvider>
  );
  return { store, drafts, simulator, wrapper };
}

/** A hook in that harness. */
export function renderEditorHook<T>(
  callback: () => T,
  options: RenderEditorOptions = {},
): RenderHookResult<T, unknown> & EditorHarness {
  const harness = editorHarness(options);
  const result = renderHook(callback, { wrapper: harness.wrapper });
  return { ...result, ...harness };
}

export type TimelineHarness = RenderResult & EditorHarness;

/** The whole page at `/lab/timeline` (or the address given), in the harness, with the address probe beside it. */
export function renderTimeline(options: RenderEditorOptions = {}): TimelineHarness {
  const harness = editorHarness(options);
  const result = render(
    <>
      <Routes>
        <Route path="/lab/timeline" element={<Timeline />} />
      </Routes>
      <AddressProbe />
    </>,
    { wrapper: harness.wrapper },
  );
  return { ...result, ...harness };
}

export type { PartContext };

/** One part of the page (the canvas, the inspector…) with the page's hooks behind it, for a test of that part. */
export function renderEditorPart(
  part: (context: PartContext) => ReactNode,
  options: RenderEditorOptions = {},
): TimelineHarness {
  const harness = editorHarness(options);
  const result = render(<EditorPart part={part} />, { wrapper: harness.wrapper });
  return { ...result, ...harness };
}

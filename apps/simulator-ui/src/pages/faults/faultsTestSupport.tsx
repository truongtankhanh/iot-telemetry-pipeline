import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { FaultKind, FaultsSnapshot, MetricSample, StateView } from '../../api/types';
import type { BenchmarkStore } from '../../state/benchmarkStore';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { Faults } from './Faults';

/**
 * Fakes for the tests of the Faults page: a state with the fixture's registry and faults the test chooses, and a simulator
 * that answers the routes under `/api/faults` the way the real one does (the state after the command), keeps the calls,
 * and can be told to refuse the next one.
 */

/** The state fixture with its faults changed. Everything is cloned: a test may change what it gets. */
export function faultState(
  changes: Partial<FaultsSnapshot> = {},
  extra: Partial<StateView> = {},
): StateView {
  const view = structuredClone(stateViewFixture);
  view.engine.faults = { ...view.engine.faults, ...changes };
  return { ...view, ...extra };
}

export const counter = (
  name: string,
  value: number,
  labels: Record<string, string> = {},
): MetricSample => ({ name, labels, value });

export interface FaultCall {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeFaultSimulator {
  fetch: typeof fetch;
  calls: FaultCall[];
  state: StateView;
  /** How many messages of every burst the broker refuses. */
  failedPerBurst: number;
  /** The next call that matches is refused with this status and sentence. */
  refuseNext(match: (call: FaultCall) => boolean, status: number, message: string): void;
  /** The next call that matches is never answered, until `release`. */
  holdNext(match: (call: FaultCall) => boolean): void;
  release(): void;
  callsTo(method: string, path: string): FaultCall[];
}

const SWITCHES = ['drop', 'duplicate', 'delay', 'reorder', 'malformed'] as const;

function recount(state: StateView): void {
  const f = state.engine.faults;
  f.activeCount = SWITCHES.filter((kind) => f[kind] !== null).length + (f.linkLoss ? 1 : 0);
  f.deviceCount =
    f.scope.mode === 'selected'
      ? f.scope.deviceIds.length
      : state.engine.devices.filter((d) => d.state === 'running').length;
}

export function fakeFaultSimulator(initial: StateView = faultState()): FakeFaultSimulator {
  const sim: FakeFaultSimulator = {
    state: structuredClone(initial),
    failedPerBurst: 0,
    calls: [],
    fetch: undefined as unknown as typeof fetch,
    refuseNext: () => {},
    holdNext: () => {},
    release: () => {},
    callsTo: (method, path) =>
      sim.calls.filter((call) => call.method === method && call.path === path),
  };
  let refusal: { match: (c: FaultCall) => boolean; status: number; message: string } | null = null;
  let hold: ((c: FaultCall) => boolean) | null = null;
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const startEffect = () => {
    sim.state.faultEffect ??= {
      since: new Date(sim.state.engine.nowMs).toISOString(),
      baseline: [],
    };
  };

  sim.refuseNext = (match, status, message) => {
    refusal = { match, status, message };
  };
  sim.holdNext = (match) => {
    hold = match;
    gate = new Promise<void>((resolve) => {
      open = resolve;
    });
  };
  sim.release = () => open();

  sim.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { method, path, body };
    sim.calls.push(call);
    if (hold?.(call)) {
      hold = null;
      await gate;
    }
    if (refusal?.match(call)) {
      const { status, message } = refusal;
      refusal = null;
      return json({ statusCode: status, error: 'Refused', message }, status);
    }

    const f = sim.state.engine.faults;
    const kind = /^\/api\/faults\/([^/]+)$/.exec(path)?.[1];
    if (method === 'GET' && path === '/api/state') return json(sim.state);
    if (method === 'PUT' && path === '/api/faults/scope') {
      f.scope = body as FaultsSnapshot['scope'];
    } else if (method === 'POST' && path === '/api/faults/burst') {
      startEffect();
      recount(sim.state);
      const count = (body as { count: number }).count;
      return json({ ...sim.state, sent: count - sim.failedPerBurst, failed: sim.failedPerBurst });
    } else if (method === 'POST' && path === '/api/faults/effect/reset') {
      sim.state.faultEffect = {
        since: new Date(sim.state.engine.nowMs).toISOString(),
        baseline: [],
      };
    } else if (method === 'DELETE' && path === '/api/faults') {
      for (const name of SWITCHES) f[name] = null as never;
      f.linkLoss = null;
    } else if (method === 'PUT' && kind !== undefined) {
      const faultKind = kind as FaultKind;
      if (faultKind === 'link-loss') {
        f.linkLoss = {
          since: new Date(sim.state.engine.nowMs).toISOString(),
          forS: (body as { forS?: number }).forS ?? null,
        };
      } else {
        (f as unknown as Record<string, unknown>)[faultKind] = body;
      }
      startEffect();
    } else if (method === 'DELETE' && kind !== undefined) {
      if (kind === 'link-loss') f.linkLoss = null;
      else (f as unknown as Record<string, unknown>)[kind] = null;
    } else {
      return json(
        { statusCode: 404, error: 'Not Found', message: `No such route: ${method} ${path}` },
        404,
      );
    }
    recount(sim.state);
    return json(sim.state);
  }) as unknown as typeof fetch;

  return sim;
}

export interface RenderFaultsOptions {
  /** The window's benchmark; a test with a run going passes one that holds it. */
  benchmark?: BenchmarkStore;
  /** The state the store holds; `null` is a page before its first message. */
  state?: StateView | null;
  link?: LinkState;
}

export type FaultsHarness = RenderResult & { store: StudioStore; sim: FakeFaultSimulator };

/** The Faults page in a router, a store and a fake simulator that `fetch` is replaced by. */
export function renderFaults(options: RenderFaultsOptions = {}): FaultsHarness {
  const { link = 'live' } = options;
  const state = options.state === undefined ? faultState() : options.state;
  const sim = fakeFaultSimulator(structuredClone(state ?? faultState()));
  vi.stubGlobal('fetch', sim.fetch);

  const store = createStudioStore();
  store.getState().setLink(link, Date.now());
  if (state) store.getState().setView(structuredClone(state), Date.now());

  const result = render(
    <StudioProvider store={store} benchmark={options.benchmark}>
      <MemoryRouter initialEntries={['/lab/faults']}>
        <Routes>
          <Route path="/lab/faults" element={<Faults />} />
        </Routes>
      </MemoryRouter>
    </StudioProvider>,
  );
  return { ...result, store, sim };
}

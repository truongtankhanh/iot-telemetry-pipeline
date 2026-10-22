/**
 * What the tests of the Lab share: a fleet of any size, and a fake simulator behind `fetch` that serves `/api/state` and
 * the library, adds and removes anomalies the way the real one answers (`201` with the id, `404` for one that is gone, a
 * refusal with the reason when told to), and answers `POST /api/expectations` with a simple but consistent guess
 * (an alert four seconds after each fault starts, clearing when it ends). Not a `*.test.tsx`, so Vitest does not run it as
 * a test file. The other pages' support files are not changed.
 */
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import scenariosFixture from '../../api/fixtures/scenarios.json';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type {
  Anomaly,
  AnomalyRequest,
  DeviceInfo,
  ExpectationPreview,
  ObservationEvent,
  ScenarioLibraryView,
  StateView,
} from '../../api/types';
import { ObservationLog } from '../../state/observationLog';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { AddressProbe } from '../fleet/AddressProbe';
import { Lab } from './Lab';

const KIND_METRICS: Record<string, DeviceInfo['metrics']> = {
  server_room: ['temperature_c', 'humidity_pct'],
  indoor_air: ['co2_ppm', 'temperature_c', 'humidity_pct'],
  power_meter: ['power_kw'],
};

const PROFILES: Record<
  string,
  Record<string, { baseline: number; noise: number; dailySwing: number }>
> = {
  server_room: {
    temperature_c: { baseline: 22.5, noise: 0.3, dailySwing: 0 },
    humidity_pct: { baseline: 45, noise: 1.5, dailySwing: 0 },
  },
  indoor_air: {
    co2_ppm: { baseline: 650, noise: 40, dailySwing: 350 },
    temperature_c: { baseline: 24, noise: 0.4, dailySwing: 1.5 },
    humidity_pct: { baseline: 55, noise: 2, dailySwing: 0 },
  },
  power_meter: { power_kw: { baseline: 120, noise: 8, dailySwing: 35 } },
};

/** The fixture's state with no anomaly and no run: the quiet engine a fault starts from. */
export function quietState(): StateView {
  const view = structuredClone(stateViewFixture);
  view.engine.anomalies = [];
  view.runs = [];
  return view;
}

/**
 * A fleet of `count` devices in `zones` zones (`Z01`…): the first third are server rooms (the only kind with a
 * temperature rule), the rest indoor air, every tenth a power meter. Ids are `d001`…; the rules, the engine's clock and
 * everything else are the fixture's.
 */
export function labFleet(count: number, zones = Math.max(1, Math.ceil(count / 5))): StateView {
  const view = quietState();
  const kindOf = (i: number) =>
    i < count / 3 ? 'server_room' : i % 10 === 9 ? 'power_meter' : 'indoor_air';
  view.devices = Array.from({ length: count }, (_, i): DeviceInfo => {
    const kind = kindOf(i);
    return {
      id: `d${String(i + 1).padStart(3, '0')}`,
      kind,
      zoneCode: `Z${String((i % zones) + 1).padStart(2, '0')}`,
      metrics: KIND_METRICS[kind]!,
      name: `Device ${i + 1}`,
    };
  });
  view.engine.devices = view.devices.map((device) => ({
    id: device.id,
    state: 'running' as const,
    intervalMs: 2000,
    seq: 1,
    holds: {},
  }));
  view.profiles = Object.fromEntries(
    view.devices.map((device) => [device.id, structuredClone(PROFILES[device.kind]!)]),
  ) as StateView['profiles'];
  view.alerts = { alerts: [], lastOkAt: view.alerts.lastOkAt, stale: false };
  return view;
}

const envelope = (status: number, error: string, message: string) => ({
  statusCode: status,
  error,
  message,
});

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

export interface Refusal {
  status: number;
  message: string;
}

export interface FakeLabSimulator {
  /** Every request made, in order. */
  calls: Call[];
  callsTo(method: string, path: string): Call[];
  /** The state the simulator holds now (an added anomaly changes it). */
  state: StateView;
  /** Refuse an `addAnomaly` for which this returns a refusal (it is given the body and its position among the adds). */
  failAdd(rule: ((body: AnomalyRequest, index: number) => Refusal | null) | null): void;
  /** Make `GET /api/state` refuse, or `null` for normal service again. */
  failState(refusal: Refusal | null): void;
  /** Make `POST /api/expectations` refuse, or `null` for normal service again. */
  failExpectations(refusal: Refusal | null): void;
  fetch: ReturnType<typeof vi.fn>;
}

/** The guess of the fake, so a test can say what it expects back: an alert four seconds after a fault starts. */
export function previewFor(anomalies: readonly Anomaly[], state: StateView): ExpectationPreview {
  const device = (id: string) => state.devices.find((d) => d.id === id);
  const raising = anomalies.filter((a) => {
    const kind = device(a.deviceId)?.kind;
    return kind === 'server_room' && a.metric === 'temperature_c' && a.value > 27;
  });
  const horizonS = Math.max(30, ...anomalies.map((a) => a.startAt + a.duration));
  return {
    expected: {
      available: true,
      intervalS: 2,
      horizonS,
      alerts: raising.map((a) => ({
        ruleId: 'server-room-hot',
        title: 'Server room temperature high',
        severity: 'high' as const,
        deviceId: a.deviceId,
        metric: a.metric,
        opensAtS: a.startAt + 4,
        opensMargin: false,
        clearsAtS: a.startAt + a.duration,
        clearsUncertain: false,
      })),
      quiet: anomalies
        .filter((a) => !raising.includes(a))
        .map((a) => ({ deviceId: a.deviceId, metric: a.metric, why: 'no-rule' as const })),
      series: anomalies.map((a) => ({
        deviceId: a.deviceId,
        metric: a.metric,
        stepS: 2,
        points: Array.from({ length: Math.floor(horizonS / 2) + 1 }, (_, i) =>
          i * 2 >= a.startAt && i * 2 < a.startAt + a.duration ? a.value : 22.5,
        ),
      })),
    },
    needsStart: [...new Set(anomalies.map((a) => a.deviceId))].flatMap((id) => {
      const engine = state.engine.devices.find((d) => d.id === id);
      return engine !== undefined && engine.state !== 'running'
        ? [{ deviceId: id, state: engine.state }]
        : [];
    }),
    intervalMs: 2000,
  };
}

/** The simulator, as `fetch` sees it. */
export function fakeLabSimulator(initial: StateView = quietState()): FakeLabSimulator {
  const calls: Call[] = [];
  let addRule: ((body: AnomalyRequest, index: number) => Refusal | null) | null = null;
  let stateFailure: Refusal | null = null;
  let expectationsFailure: Refusal | null = null;
  let adds = 0;
  let nextId = 1;

  const library = structuredClone(scenariosFixture) as unknown as ScenarioLibraryView;

  const sim: FakeLabSimulator = {
    calls,
    callsTo: (method, path) => calls.filter((c) => c.method === method && c.path === path),
    state: initial,
    failAdd: (rule) => {
      addRule = rule;
    },
    failState: (refusal) => {
      stateFailure = refusal;
    },
    failExpectations: (refusal) => {
      expectationsFailure = refusal;
    },
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: url, body });
      const refuse = (r: Refusal) => respond(r.status, envelope(r.status, 'Refused', r.message));

      if (method === 'GET' && url === '/api/state') {
        return stateFailure ? refuse(stateFailure) : respond(200, sim.state);
      }
      if (method === 'GET' && url === '/api/scenarios') return respond(200, library);

      if (method === 'POST' && url === '/api/anomalies') {
        const request = body as AnomalyRequest;
        const index = adds++;
        const refusal = addRule?.(request, index) ?? null;
        if (refusal) return refuse(refusal);
        if (!sim.state.devices.some((d) => d.id === request.deviceId)) {
          return respond(404, envelope(404, 'Not Found', `Unknown device "${request.deviceId}"`));
        }
        const id = `x${nextId++}`;
        const startAt = request.startAt ?? sim.state.engine.elapsedS + (request.startIn ?? 0);
        const anomaly: Anomaly = {
          deviceId: request.deviceId,
          metric: request.metric,
          value: request.value,
          startAt,
          duration: request.duration,
          ...(request.shape === undefined ? {} : { shape: request.shape }),
        };
        sim.state = {
          ...sim.state,
          engine: {
            ...sim.state.engine,
            anomalies: [...sim.state.engine.anomalies, { id, anomaly }],
          },
        };
        return respond(201, { id, ...sim.state });
      }

      const removal = /^\/api\/anomalies\/([^/]+)$/.exec(url);
      if (method === 'DELETE' && removal) {
        const id = decodeURIComponent(removal[1]!);
        if (!sim.state.engine.anomalies.some((a) => a.id === id)) {
          return respond(404, envelope(404, 'Not Found', `Unknown anomaly "${id}"`));
        }
        sim.state = {
          ...sim.state,
          engine: {
            ...sim.state.engine,
            anomalies: sim.state.engine.anomalies.filter((a) => a.id !== id),
          },
        };
        return respond(200, sim.state);
      }

      if (method === 'POST' && url === '/api/expectations') {
        if (expectationsFailure) return refuse(expectationsFailure);
        const { anomalies } = body as { anomalies: Anomaly[] };
        return respond(200, previewFor(anomalies, sim.state));
      }

      return respond(404, envelope(404, 'Not Found', `No such route ${method} ${url}`));
    }),
  };
  return sim;
}

export interface RenderLabOptions {
  /** The address to start at, query included. */
  path?: string;
  /** The state the store holds; `null` is a page before its first message. */
  state?: StateView | null;
  link?: LinkState;
  /** Observations the log already holds. */
  events?: ObservationEvent[];
}

export type LabHarness = RenderResult & {
  store: StudioStore;
  simulator: FakeLabSimulator;
  observations: ObservationLog;
};

/** The Lab in a router (starting at `path`), a store and an observation log, with `fetch` replaced by the fake simulator. */
export function renderLab(options: RenderLabOptions = {}): LabHarness {
  const { path = '/lab', link = 'live', events = [] } = options;
  const state = options.state === undefined ? labFleet(6) : options.state;
  const simulator = fakeLabSimulator(structuredClone(state ?? labFleet(6)));
  vi.stubGlobal('fetch', simulator.fetch);

  const store = createStudioStore();
  store.getState().setLink(link, Date.now());
  if (state) store.getState().setView(structuredClone(state), Date.now());
  const observations = new ObservationLog({ notifyEveryMs: 0 });
  observations.seed(events);

  const result = render(
    <StudioProvider store={store} observations={observations}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lab" element={<Lab />} />
        </Routes>
        <AddressProbe />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { ...result, store, simulator, observations };
}

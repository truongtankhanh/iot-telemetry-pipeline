/**
 * What the tests of the Fleet share: a fake simulator behind `fetch` that applies the commands to a state view and
 * answers with it (as the real one does), a history seeded with a few seconds of readings, and a render that puts
 * the page in a router and a provider. Not a `*.test.tsx`, so Vitest does not run it as a test file.
 */
import { telemetryTopic } from '@itp/telemetry-contract';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { DeviceInfo, PublishedMessage, StateView } from '../../api/types';
import { HistoryStore } from '../../state/history';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { AddressProbe } from './AddressProbe';
import { Fleet } from './Fleet';

export interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

const envelope = (status: number, message: string) => ({
  statusCode: status,
  error: 'Error',
  message,
});

/**
 * A simulator that applies start, pause, stop, interval, hold and release to its own copy of the state and answers
 * every command with the whole state. A device in `failFor` is refused as unknown.
 */
export function fakeSimulator(initial: StateView, failFor: readonly string[] = []) {
  const view = structuredClone(initial);
  const calls: RecordedCall[] = [];

  const respond = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const send = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ method, url, body });
    if (url === '/api/state') return respond(200, view);

    const match = /^\/api\/devices\/([^/]+)\/(.+)$/.exec(url);
    if (!match) return respond(404, envelope(404, `No such route: ${method} ${url}`));
    const id = decodeURIComponent(match[1] as string);
    const action = match[2] as string;
    const device = view.engine.devices.find((d) => d.id === id);
    if (!device || failFor.includes(id))
      return respond(404, envelope(404, `Unknown device "${id}"`));

    if (action === 'start') device.state = 'running';
    else if (action === 'pause') device.state = 'paused';
    else if (action === 'stop') device.state = 'stopped';
    else if (action === 'interval') {
      const ms = (body as { intervalMs: number | null }).intervalMs;
      device.intervalMs = ms ?? view.config.intervalMs;
    } else if (action.startsWith('holds/')) {
      const metric = decodeURIComponent(action.slice('holds/'.length)) as keyof typeof device.holds;
      if (method === 'PUT') device.holds[metric] = (body as { value: number }).value;
      else delete device.holds[metric];
    } else return respond(404, envelope(404, `No such route: ${method} ${url}`));
    return respond(200, view);
  });

  return { view, calls, fetch: send };
}

export type FakeSimulator = ReturnType<typeof fakeSimulator>;

/** The calls of one kind, e.g. `calls(sim, 'POST', 'pause')` for the devices that were asked to pause. */
export const deviceCalls = (simulator: FakeSimulator, method: string, action: string) =>
  simulator.calls.filter((call) => call.method === method && call.url.endsWith(`/${action}`));

/** A copy of the fixture state with `count` generic devices (two metrics each, three zones), all running. */
export function viewWithDevices(count: number): StateView {
  const view = structuredClone(stateViewFixture);
  const devices: DeviceInfo[] = Array.from({ length: count }, (_, i) => ({
    id: `dev-${String(i + 1).padStart(2, '0')}`,
    kind: 'server_room',
    zoneCode: `BLD-Z${i % 3}`,
    metrics: ['temperature_c', 'humidity_pct'],
    name: `Device ${i + 1}`,
  }));
  view.devices = devices;
  view.engine.devices = devices.map((d) => ({
    id: d.id,
    state: 'running',
    intervalMs: 2000,
    seq: 1,
    holds: {},
  }));
  view.engine.anomalies = [];
  view.profiles = {};
  return view;
}

const DEFAULT_VALUES: Record<string, number> = {
  temperature_c: 22.4,
  humidity_pct: 46,
  co2_ppm: 702,
  power_kw: 142.3,
};

/**
 * A few seconds of readings for every device of the view, ending a second ago (so no device is silent), with the
 * fixture's story: dc-env-01 is above its raise line, lha-air-01 holds 1450 ppm (above its), hub-power-01 is paused
 * and was last heard 40 seconds ago.
 */
export function seedHistory(history: HistoryStore, view: StateView, now = Date.now()): void {
  const messages: PublishedMessage[] = [];
  let seq = 1;
  for (const device of view.devices) {
    const paused = device.id === 'hub-power-01';
    for (let step = 9; step >= 0; step--) {
      const agoMs = (paused ? 40_000 : 1000) + step * 2000;
      const ts = new Date(now - agoMs).toISOString();
      const metrics: Record<string, number> = {};
      for (const metric of device.metrics) {
        metrics[metric] = DEFAULT_VALUES[metric] ?? 50;
        if (device.id === 'dc-env-01' && metric === 'temperature_c' && step < 3)
          metrics[metric] = 29.3;
        if (device.id === 'lha-air-01' && metric === 'co2_ppm') metrics[metric] = 1450;
      }
      messages.push({
        deviceId: device.id,
        topic: telemetryTopic({ zoneCode: device.zoneCode, deviceId: device.id }),
        payload: JSON.stringify({ seq, ts, metrics }),
        seq: seq++,
        ts,
      });
    }
  }
  history.seed(messages.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)));
}

export interface RenderFleetOptions {
  path?: string;
  /** The state the store holds; `null` is a page before its first message. */
  view?: StateView | null;
  link?: LinkState;
  /** Fill the history with readings (default). */
  seed?: boolean;
  /** Devices the fake simulator refuses as unknown. */
  failFor?: readonly string[];
}

/** The Fleet in a router (starting at `path`), a store and a history, with `fetch` replaced by the fake simulator. */
export type FleetHarness = RenderResult & {
  store: StudioStore;
  history: HistoryStore;
  simulator: FakeSimulator;
};

export function renderFleet(options: RenderFleetOptions = {}): FleetHarness {
  const { path = '/fleet', link = 'live', seed = true, failFor = [] } = options;
  const view = options.view === undefined ? structuredClone(stateViewFixture) : options.view;
  const simulator = fakeSimulator(view ?? stateViewFixture, failFor);
  vi.stubGlobal('fetch', simulator.fetch);

  const store = createStudioStore();
  store.getState().setLink(link, Date.now());
  if (view) store.getState().setView(structuredClone(view), Date.now());
  const history = new HistoryStore();
  if (view && seed) seedHistory(history, view);

  const result = render(
    <StudioProvider store={store} history={history}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/fleet" element={<Fleet />} />
        </Routes>
        <AddressProbe />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { ...result, store, history, simulator };
}

export const address = () => document.querySelector('[data-testid="location"]')?.textContent ?? '';

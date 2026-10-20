/**
 * What the tests of the Alerts page share: a fake simulator behind `fetch` that serves `/api/state` and pages through
 * a list of alerts the way ingest does (a cursor it issues, `X-Next-Cursor`, a refusal for a cursor it never issued),
 * a few builders, and a render that puts the page in a router and a provider. Not a `*.test.tsx`, so Vitest does not
 * run it as a test file. The Fleet's support file is used for the history and the address and is not changed.
 */
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import alertsPageFixture from '../../api/fixtures/alerts-page.json';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { PagedAlert, StateView } from '../../api/types';
import { HistoryStore } from '../../state/history';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { AddressProbe } from '../fleet/AddressProbe';
import { seedHistory } from '../fleet/fleetTestSupport';
import { Alerts } from './Alerts';

export { address } from '../fleet/fleetTestSupport';

/** The two alerts of the fixture: #7 cleared with a cause and a delivered incident, #6 open and skipped. */
export const fixtureAlerts = (): PagedAlert[] =>
  structuredClone(alertsPageFixture) as unknown as PagedAlert[];

/** An alert with plain defaults (open, pending, no cause, no observed times), for building a longer list. */
export function alertRow(overrides: Partial<PagedAlert> = {}): PagedAlert {
  return {
    id: '1',
    deviceId: 'dc-env-01',
    ruleId: 'server-room-hot',
    metric: 'temperature_c',
    severity: 'high',
    title: 'Server room temperature high',
    status: 'open',
    openedAt: new Date().toISOString(),
    openedValue: 29.3,
    clearedAt: null,
    clearedValue: null,
    externalRef: null,
    deliveryStatus: 'pending',
    deliveryAttempts: 0,
    deliveryError: null,
    preexisting: true,
    observed: {
      openedAt: null,
      clearedAt: null,
      delivered: { opened: null, cleared: null },
      incident: null,
    },
    cause: null,
    ...overrides,
  };
}

/** `count` alerts, newest first (ids `count` down to 1), severities in turn, all open and pending. */
export function manyAlerts(count: number): PagedAlert[] {
  const severities = ['high', 'medium', 'low', 'critical'];
  return Array.from({ length: count }, (_, i) => {
    const id = String(count - i);
    return alertRow({
      id,
      title: `Alert number ${id}`,
      severity: severities[i % severities.length] as string,
      openedAt: new Date(Date.now() - i * 60_000).toISOString(),
    });
  });
}

const envelope = (status: number, message: string) => ({
  statusCode: status,
  error: status === 502 ? 'Bad Gateway' : 'Bad Request',
  message,
});

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export interface FakeAlertsSimulator {
  /** Every request made, in order. */
  calls: string[];
  /** The requests for `/api/alerts`. */
  alertCalls(): string[];
  /** Make `/api/alerts` answer with an error (a 502, a 400), or `null` for normal service again. */
  failWith(error: { status: number; message: string } | null): void;
  fetch: ReturnType<typeof vi.fn>;
}

/** Ingest's alerts as the simulator relays them: newest first, filtered by `status`, paged by cursors it issues. */
export function fakeAlertsSimulator(view: StateView, alerts: PagedAlert[]): FakeAlertsSimulator {
  const calls: string[] = [];
  const issued = new Map<string, { offset: number; status: string }>();
  let failure: { status: number; message: string } | null = null;

  const send = vi.fn(async (url: string) => {
    calls.push(url);
    if (url === '/api/state') return respond(200, view);
    if (!url.startsWith('/api/alerts')) return respond(404, envelope(404, `No such route: ${url}`));
    if (failure) return respond(failure.status, envelope(failure.status, failure.message));

    const params = new URL(url, 'http://localhost').searchParams;
    const status = params.get('status') ?? 'all';
    const limit = Number(params.get('limit') ?? 200);
    const before = params.get('before');
    let offset = 0;
    if (before !== null) {
      const known = issued.get(before);
      if (known === undefined || known.status !== status) {
        return respond(400, envelope(400, `ingest did not issue the cursor "${before}"`));
      }
      offset = known.offset;
    }
    const matching = alerts.filter((alert) => status === 'all' || alert.status === status);
    const rows = matching.slice(offset, offset + limit);
    const more = offset + limit < matching.length;
    const cursor = `cur-${status}-${offset + limit}`;
    if (more) issued.set(cursor, { offset: offset + limit, status });
    return respond(200, rows, more ? { 'X-Next-Cursor': cursor } : {});
  });

  return {
    calls,
    alertCalls: () => calls.filter((call) => call.startsWith('/api/alerts')),
    failWith: (error) => {
      failure = error;
    },
    fetch: send,
  };
}

export interface RenderAlertsOptions {
  path?: string;
  /** The state the store holds; `null` is a page before its first message. */
  view?: StateView | null;
  /** What ingest holds, newest first. The store's own alerts are the view's, as in the real thing. */
  alerts?: PagedAlert[];
  link?: LinkState;
  /** Fill the history with readings (default). */
  seed?: boolean;
}

export type AlertsHarness = RenderResult & {
  store: StudioStore;
  history: HistoryStore;
  simulator: FakeAlertsSimulator;
};

/** The Alerts page in a router (starting at `path`), a store and a history, with `fetch` replaced by the fake simulator. */
export function renderAlerts(options: RenderAlertsOptions = {}): AlertsHarness {
  const { path = '/alerts', link = 'live', seed = true } = options;
  const view = options.view === undefined ? structuredClone(stateViewFixture) : options.view;
  const simulator = fakeAlertsSimulator(
    view ?? stateViewFixture,
    options.alerts ?? fixtureAlerts(),
  );
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
          <Route path="/alerts" element={<Alerts />} />
        </Routes>
        <AddressProbe />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { ...result, store, history, simulator };
}

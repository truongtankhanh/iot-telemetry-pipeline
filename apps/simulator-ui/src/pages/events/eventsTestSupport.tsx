/**
 * What the tests of the Event stream share: builders for published messages and sampling reports, a fake simulator behind
 * `fetch` that answers `/api/state` and `POST /api/messages/:id/republish` the way the control API does (statuses and the
 * envelope of a refusal), and a render that puts the page in a router, a store and a message log. Not a `*.test.tsx`, so Vitest
 * does not run it as a test file. The Fleet's support file is used for the address and is not changed.
 */
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { PublishedMessage, SamplingReport, Snapshot, StateView } from '../../api/types';
import { MessageLog } from '../../state/messageLog';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { AddressProbe } from '../fleet/AddressProbe';
import { Events } from './Events';

export { address } from '../fleet/fleetTestSupport';

const T0 = Date.parse('2026-10-23T08:00:00.000Z');

/** A published message: temperature 22.5 and humidity 45 for `dc-env-01`, `id` seconds after 08:00:00 UTC, `seq` = `id`. */
export function publishedMessage(
  id: number,
  overrides: Partial<PublishedMessage> = {},
): PublishedMessage {
  const ts = new Date(T0 + id * 1000).toISOString();
  const deviceId = overrides.deviceId ?? 'dc-env-01';
  const zone = deviceId.startsWith('lib') ? 'BLD-LIB' : 'BLD-DC';
  return {
    id,
    at: ts,
    ackMs: 3.1,
    deviceId,
    topic: `campus/${zone}/${deviceId}/telemetry`,
    payload: JSON.stringify({
      seq: id,
      ts,
      metrics: { temperature_c: 22.5, humidity_pct: 45 },
    }),
    seq: id,
    ts,
    ...overrides,
  };
}

/** `count` messages, ids 1 to `count`, oldest first (the order of the simulator's log). */
export const manyMessages = (count: number): PublishedMessage[] =>
  Array.from({ length: count }, (_, i) => publishedMessage(i + 1));

export function samplingReport(overrides: Partial<SamplingReport> = {}): SamplingReport {
  return {
    total: 1000,
    skipped: 750,
    forwarded: 250,
    windowMs: 1000,
    budgetPerS: 250,
    active: true,
    ...overrides,
  };
}

export interface FakeEventsSimulator {
  /** Every request made, in order. */
  calls: { method: string; path: string }[];
  /** Make the republish answer with a refusal (404, 409, 502), or `null` for normal service again. */
  failWith(error: { status: number; message: string } | null): void;
  fetch: ReturnType<typeof vi.fn>;
}

const respond = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  502: 'Bad Gateway',
};

/** The control API as far as this page uses it: the state, and a republish of a message it holds. */
export function fakeEventsSimulator(
  view: StateView,
  held: PublishedMessage[],
): FakeEventsSimulator {
  const calls: { method: string; path: string }[] = [];
  let failure: { status: number; message: string } | null = null;
  let nextId = 99;

  const send = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url });
    if (url === '/api/state') return respond(200, view);
    const match = /^\/api\/messages\/(\d+)\/republish$/.exec(url);
    if (method === 'POST' && match) {
      if (failure) {
        return respond(failure.status, {
          statusCode: failure.status,
          error: ERROR_NAMES[failure.status] ?? 'Error',
          message: failure.message,
        });
      }
      const original = held.find((m) => m.id === Number(match[1]));
      if (!original) {
        return respond(404, {
          statusCode: 404,
          error: 'Not Found',
          message: `Message ${match[1]} is not in the publish log; only the last 200 are kept`,
        });
      }
      const message: PublishedMessage = { ...original, id: nextId++, fault: 'republish' };
      return respond(200, {
        ...view,
        faultEffect: { since: new Date(T0).toISOString(), baseline: [] },
        message,
      });
    }
    return respond(404, { statusCode: 404, error: 'Not Found', message: `No such route: ${url}` });
  });

  return {
    calls,
    failWith: (error) => {
      failure = error;
    },
    fetch: send,
  };
}

export interface RenderEventsOptions {
  path?: string;
  /** The state the store holds; `null` is a page before its first message. */
  view?: StateView | null;
  /** The publish log the snapshot brings, oldest first. */
  messages?: PublishedMessage[];
  /** The simulator's count of every message; the number of `messages` when not given. */
  total?: number;
  sampling?: Snapshot['sampling'];
  link?: LinkState;
  /** How many messages the log keeps (200 in the app; a test narrows it to see one leave). */
  capacity?: number;
  publishRate?: number;
}

export type EventsHarness = RenderResult & {
  store: StudioStore;
  log: MessageLog;
  simulator: FakeEventsSimulator;
};

/** The Event stream in a router (starting at `path`), a store and a message log, with `fetch` replaced by the fake simulator. */
export function renderEvents(options: RenderEventsOptions = {}): EventsHarness {
  const { path = '/events', link = 'live', messages = [], capacity } = options;
  const view = options.view === undefined ? structuredClone(stateViewFixture) : options.view;
  const simulator = fakeEventsSimulator(view ?? stateViewFixture, messages);
  vi.stubGlobal('fetch', simulator.fetch);

  const store = createStudioStore();
  store.getState().setLink(link, Date.now());
  if (view) store.getState().setView(structuredClone(view), Date.now());
  if (options.publishRate !== undefined) store.getState().setPublishRate(options.publishRate);

  const log = new MessageLog(capacity === undefined ? {} : { capacity });
  log.seed(messages, { total: options.total, sampling: options.sampling });

  const result = render(
    <StudioProvider store={store} messages={log}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/events" element={<Events />} />
          <Route path="/lab/faults" element={<p>The Faults page</p>} />
        </Routes>
        <AddressProbe />
      </MemoryRouter>
    </StudioProvider>,
  );
  return { ...result, store, log, simulator };
}

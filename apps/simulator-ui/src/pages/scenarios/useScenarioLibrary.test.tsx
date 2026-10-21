import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import scenariosFixture from '../../api/fixtures/scenarios.json';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { StateView } from '../../api/types';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { librarySignature, useScenarioLibrary } from './useScenarioLibrary';

afterEach(() => vi.unstubAllGlobals());

interface Call {
  url: string;
  signal: AbortSignal | undefined;
}

type Handler = (call: Call) => Promise<Response> | Response;

const library = (body: unknown = scenariosFixture): Response => new Response(JSON.stringify(body));

const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ statusCode: status, error: 'Bad Gateway', message }), { status });

/** The simulator, as `fetch` sees it: every request is recorded, and `handler` answers it. */
function setup(handler: Handler, options: { withState?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, signal: init?.signal ?? undefined };
      calls.push(call);
      return handler(call);
    }),
  );
  const store = createStudioStore();
  if (options.withState !== false) store.getState().setView(structuredClone(stateViewFixture), 1);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store}>{children}</StudioProvider>
  );
  const hook = renderHook(() => useScenarioLibrary(), { wrapper });
  return { calls, store, hook };
}

const ready = (hook: ReturnType<typeof setup>['hook']) =>
  waitFor(() => expect(hook.result.current.status).toBe('ready'));

/** The state with one device in another state, or another interval. */
function withDevice(view: StateView, id: string, change: { state?: string; intervalMs?: number }) {
  return {
    ...view,
    engine: {
      ...view.engine,
      devices: view.engine.devices.map((d) => (d.id === id ? { ...d, ...change } : d)),
    },
  } as StateView;
}

describe('librarySignature', () => {
  it('is null before the first state', () => {
    expect(librarySignature(null)).toBeNull();
  });

  it('changes with the runs, a device state and a device interval, and with nothing else', () => {
    const view = structuredClone(stateViewFixture);
    const base = librarySignature(view);
    expect(librarySignature({ ...view, observationCursor: 99 })).toBe(base);
    expect(librarySignature({ ...view, scenarios: ['x'] })).toBe(base);
    expect(librarySignature(withDevice(view, 'dc-env-01', { state: 'stopped' }))).not.toBe(base);
    expect(librarySignature(withDevice(view, 'dc-env-01', { intervalMs: 500 }))).not.toBe(base);
    const running = {
      ...view,
      runs: [
        {
          id: 'r1',
          scenario: 'server-room-overheat',
          startedAt: '2026-10-21T08:00:00.000Z',
          offsetS: 0,
          endsAtS: 80,
          anomalyIds: ['a1'],
          startedDevices: [],
        },
      ],
    };
    expect(librarySignature(running)).not.toBe(base);
  });
});

describe('useScenarioLibrary', () => {
  it('reads the library once the first state has arrived, with the time it was fetched', async () => {
    const { calls, hook } = setup(() => library());
    expect(hook.result.current.status).toBe('loading');
    expect(hook.result.current.library).toBeNull();

    await ready(hook);

    expect(calls.map((call) => call.url)).toEqual(['/api/scenarios']);
    expect(hook.result.current.library).toEqual(scenariosFixture);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.fetchedAt).not.toBeNull();
  });

  it('asks nothing before the first state, and reads once it comes', async () => {
    const { calls, store, hook } = setup(() => library(), { withState: false });
    await act(async () => {});
    expect(calls).toEqual([]);
    expect(hook.result.current.status).toBe('loading');

    act(() => store.getState().setView(structuredClone(stateViewFixture), 1));
    await ready(hook);
    expect(calls).toHaveLength(1);
  });

  it('reads again when a device changes state or a run starts, and not for other changes of the state', async () => {
    const { calls, store, hook } = setup(() => library());
    await ready(hook);

    act(() =>
      store.getState().setView({ ...structuredClone(stateViewFixture), observationCursor: 9 }, 2),
    );
    await act(async () => {});
    expect(calls).toHaveLength(1);

    act(() =>
      store
        .getState()
        .setView(
          withDevice(structuredClone(stateViewFixture), 'dc-env-01', { state: 'stopped' }),
          3,
        ),
    );
    await waitFor(() => expect(calls).toHaveLength(2));
    await ready(hook);
  });

  it('reads again on refresh', async () => {
    const { calls, hook } = setup(() => library());
    await ready(hook);
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('keeps the library on show when a later read fails, says why, and recovers on a retry', async () => {
    let refuse = false;
    const { hook } = setup(() =>
      refuse ? failure(502, 'The simulator cannot be reached') : library(),
    );
    await ready(hook);

    refuse = true;
    act(() => hook.result.current.refresh());
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.error).toBe('The simulator cannot be reached');
    expect(hook.result.current.library).toEqual(scenariosFixture);

    refuse = false;
    act(() => hook.result.current.refresh());
    await ready(hook);
    expect(hook.result.current.error).toBeNull();
  });

  it('reports a first read that fails as an error with no library', async () => {
    const { hook } = setup(() => failure(403, 'The Host header must name this machine'));
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.library).toBeNull();
    expect(hook.result.current.error).toBe('The Host header must name this machine');
  });

  it('aborts a read that is overtaken, and never shows its answer', async () => {
    const slow: { resolve: (response: Response) => void } = { resolve: () => {} };
    const newer = { ...scenariosFixture, scenarios: scenariosFixture.scenarios.slice(0, 1) };
    let asked = 0;
    const { calls, store, hook } = setup(() => {
      asked += 1;
      if (asked === 1) return new Promise<Response>((resolve) => (slow.resolve = resolve));
      return library(newer);
    });
    await waitFor(() => expect(calls).toHaveLength(1));

    act(() =>
      store
        .getState()
        .setView(
          withDevice(structuredClone(stateViewFixture), 'dc-env-01', { state: 'paused' }),
          2,
        ),
    );
    await ready(hook);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(hook.result.current.library?.scenarios).toHaveLength(1);

    // The first request answers late, with the older library: it is not shown.
    await act(async () => slow.resolve(library()));
    expect(hook.result.current.library?.scenarios).toHaveLength(1);
  });

  it('aborts the read in flight when the page is left', async () => {
    const { calls, hook } = setup(() => new Promise<Response>(() => {}));
    await waitFor(() => expect(calls).toHaveLength(1));
    hook.unmount();
    expect(calls[0]?.signal?.aborted).toBe(true);
  });
});

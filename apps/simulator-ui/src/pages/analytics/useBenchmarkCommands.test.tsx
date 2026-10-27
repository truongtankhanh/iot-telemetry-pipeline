import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { benchmarkFixture } from '../../api/fixtures/benchmarkFixtures';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { BenchmarkRunDetail, BenchmarkRunSummary } from '../../api/types';
import { BenchmarkStore } from '../../state/benchmarkStore';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { useBenchmarkCommands } from './useBenchmarkCommands';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const going = benchmarkFixture.current as BenchmarkRunDetail;
const run: BenchmarkRunSummary = (() => {
  const summary: Partial<BenchmarkRunDetail> = structuredClone(going);
  delete summary.series;
  return summary as BenchmarkRunSummary;
})();

function setup(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchFn);
  vi.stubGlobal('fetch', fetchMock);
  const store = createStudioStore();
  store.getState().setView(structuredClone(stateViewFixture), 1);
  const benchmark = new BenchmarkStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store} benchmark={benchmark}>
      {children}
    </StudioProvider>
  );
  const hook = renderHook(() => useBenchmarkCommands(), { wrapper });
  return { store, benchmark, hook, fetchMock };
}

describe('useBenchmarkCommands', () => {
  it('is idle at the start', () => {
    const { hook } = setup(async () => json({}));
    const { starting, stopping, error, refused } = hook.result.current;
    expect([starting, stopping, error, refused]).toEqual([false, false, null, null]);
  });

  it('starts a run: posts the size with the confirmation, gives the run to the benchmark and the state to the store', async () => {
    const { store, benchmark, hook, fetchMock } = setup(async () =>
      json({ ...structuredClone(stateViewFixture), run }),
    );
    let accepted = false;
    await act(async () => {
      accepted = await hook.result.current.start(100_000);
    });

    expect(accepted).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/benchmark');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ messages: 100_000, confirm: true });
    expect(benchmark.get().status).toEqual({ id: 3, phase: 'publishing' });
    expect(store.getState().view).not.toHaveProperty('run');
    expect(hook.result.current.starting).toBe(false);
    expect(hook.result.current.error).toBeNull();
  });

  it('is starting while the request is out, and ignores a second press', async () => {
    const release: ((response: Response) => void)[] = [];
    const { hook, fetchMock } = setup(
      () =>
        new Promise<Response>((resolve) => {
          release.push(resolve);
        }),
    );
    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = hook.result.current.start(10);
    });
    expect(hook.result.current.starting).toBe(true);

    let second = true;
    await act(async () => {
      second = await hook.result.current.start(10);
    });
    expect(second).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      release[0]?.(json({ ...structuredClone(stateViewFixture), run }));
      await first;
    });
    expect(hook.result.current.starting).toBe(false);
  });

  it('keeps the simulator’s reason when it refuses, and the checks a refused start named', async () => {
    const checks = [
      { id: 'fleet', label: 'Fleet paused', ok: false, reason: 'dc-env-01 is running' },
    ];
    const { benchmark, hook } = setup(async () =>
      json(
        { statusCode: 409, error: 'Conflict', message: 'The benchmark cannot start', checks },
        409,
      ),
    );
    let accepted = true;
    await act(async () => {
      accepted = await hook.result.current.start(10);
    });
    expect(accepted).toBe(false);
    expect(hook.result.current.error).toBe('The benchmark cannot start');
    expect(hook.result.current.refused).toEqual(checks);
    expect(benchmark.get().status).toBeNull();

    act(() => hook.result.current.clearError());
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.refused).toBeNull();
  });

  it('has no checks to show for a refusal of another kind', async () => {
    const { hook } = setup(async () =>
      json({ statusCode: 409, error: 'Conflict', message: 'A benchmark is already running' }, 409),
    );
    await act(async () => {
      await hook.result.current.start(10);
    });
    expect(hook.result.current.error).toBe('A benchmark is already running');
    expect(hook.result.current.refused).toBeNull();
  });

  it('says it cannot reach the simulator when there is no answer', async () => {
    const { hook } = setup(async () => {
      throw new TypeError('Failed to fetch');
    });
    await act(async () => {
      await hook.result.current.start(10);
    });
    expect(hook.result.current.error).toBe('Cannot reach the simulator');
  });

  it('stops the run, is stopping until the simulator answers, and puts the state in the store', async () => {
    const release: ((response: Response) => void)[] = [];
    const { store, hook, fetchMock } = setup(
      () =>
        new Promise<Response>((resolve) => {
          release.push(resolve);
        }),
    );
    let stopped: Promise<boolean> = Promise.resolve(false);
    act(() => {
      stopped = hook.result.current.stop();
    });
    expect(hook.result.current.stopping).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/benchmark/stop');
    expect(init.method).toBe('POST');

    await act(async () => {
      release[0]?.(json(structuredClone(stateViewFixture)));
      expect(await stopped).toBe(true);
    });
    expect(hook.result.current.stopping).toBe(false);
    expect(store.getState().view?.engine.devices.length).toBeGreaterThan(0);
  });

  it('is not held back by a start that is still out', async () => {
    const release: ((response: Response) => void)[] = [];
    const { hook, fetchMock } = setup(
      (url) =>
        new Promise<Response>((resolve) => {
          release.push(resolve);
          if (url.endsWith('/stop')) {
            resolve(
              json({ statusCode: 409, error: 'Conflict', message: 'No benchmark is running' }, 409),
            );
          }
        }),
    );
    act(() => {
      void hook.result.current.start(10);
    });
    await act(async () => {
      expect(await hook.result.current.stop()).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hook.result.current.error).toBe('No benchmark is running');
  });

  it('says so when there is no run to stop', async () => {
    const { hook } = setup(async () =>
      json({ statusCode: 409, error: 'Conflict', message: 'No benchmark is running' }, 409),
    );
    await act(async () => {
      await hook.result.current.stop();
    });
    expect(hook.result.current.error).toBe('No benchmark is running');
    expect(hook.result.current.stopping).toBe(false);
  });
});

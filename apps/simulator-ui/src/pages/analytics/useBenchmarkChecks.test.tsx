import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { benchmarkPreflightFixture } from '../../api/fixtures/benchmarkFixtures';
import type { BenchmarkCheck } from '../../api/types';
import { useBenchmarkChecks } from './useBenchmarkChecks';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const failing: BenchmarkCheck = {
  id: 'fleet',
  label: 'Fleet paused',
  ok: false,
  reason: 'dc-env-01 is running',
};

describe('useBenchmarkChecks', () => {
  it('reads the checks when it starts, and is loading until they arrive', async () => {
    const fetchMock = vi.fn(async () => json(benchmarkPreflightFixture));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useBenchmarkChecks({ enabled: true, watch: 'a' }));
    expect(result.current.loading).toBe(true);
    expect(result.current.checks).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.checks.map((check) => check.id)).toEqual(['ingest', 'database', 'fleet']);
    expect(result.current.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/benchmark/preflight');
  });

  it('asks again on refresh, and again when what the checks depend on changes', async () => {
    const fetchMock = vi.fn(async () => json(benchmarkPreflightFixture));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(
      ({ watch }) => useBenchmarkChecks({ enabled: true, watch }),
      { initialProps: { watch: 'running:1' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.refresh());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ watch: 'running:0' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('reads nothing while it is not enabled', async () => {
    const fetchMock = vi.fn(async () => json(benchmarkPreflightFixture));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useBenchmarkChecks({ enabled: false, watch: 'a' }));
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says why the checks could not be read, and keeps none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ statusCode: 503, error: 'x', message: 'not configured' }, 503)),
    );
    const { result } = renderHook(() => useBenchmarkChecks({ enabled: true, watch: 'a' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('not configured');
    expect(result.current.checks).toEqual([]);
  });

  it('never lets an older answer overwrite a newer one', async () => {
    const release: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            release.push(resolve);
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    const { result, rerender } = renderHook(
      ({ watch }) => useBenchmarkChecks({ enabled: true, watch }),
      { initialProps: { watch: 'first' } },
    );
    rerender({ watch: 'second' });
    await waitFor(() => expect(release).toHaveLength(2));

    // The first request was aborted when the second began: answering it changes nothing.
    await act(async () => {
      release[0]?.(json({ checks: [failing] }));
      release[1]?.(json(benchmarkPreflightFixture));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.checks.map((check) => check.ok)).toEqual([true, true, true]);
  });
});

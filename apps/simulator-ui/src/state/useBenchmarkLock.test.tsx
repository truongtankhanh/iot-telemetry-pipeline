import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { benchmarkFixture } from '../api/fixtures/benchmarkFixtures';
import type { BenchmarkRunDetail, BenchmarkRunSummary } from '../api/types';
import { BenchmarkStore } from './benchmarkStore';
import { StudioProvider } from './StudioProvider';
import { createStudioStore } from './store';
import { useBenchmarkLock } from './useBenchmarkLock';

const going = benchmarkFixture.current as BenchmarkRunDetail;

function summaryOf(change: Partial<BenchmarkRunSummary> = {}): BenchmarkRunSummary {
  const summary: Partial<BenchmarkRunDetail> = structuredClone(going);
  delete summary.series;
  return { ...(summary as BenchmarkRunSummary), ...change };
}

function setup(benchmark = new BenchmarkStore()) {
  const store = createStudioStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store} benchmark={benchmark}>
      {children}
    </StudioProvider>
  );
  return { benchmark, ...renderHook(() => useBenchmarkLock(), { wrapper }) };
}

describe('useBenchmarkLock', () => {
  it('is not locked while no benchmark runs, and has no reason', () => {
    const { result } = setup();
    expect(result.current).toEqual({ locked: false, reason: null });
  });

  it('locks from the first moment of a run, with the reason in a sentence', () => {
    const { result, benchmark } = setup();
    act(() => benchmark.applyEvent({ run: summaryOf({ phase: 'starting' }), point: null }));
    expect(result.current.locked).toBe(true);
    expect(result.current.reason).toBe(
      'A benchmark is running (run 3, starting): the controls that publish are locked until it ends.',
    );
  });

  it('stays the same object for the points of a run, and changes with the phase', () => {
    const { result, benchmark } = setup();
    act(() => benchmark.applyEvent({ run: summaryOf({ elapsedMs: 1000 }), point: null }));
    const first = result.current;
    act(() =>
      benchmark.applyEvent({
        run: summaryOf({ elapsedMs: 2000 }),
        point: { t: 2, published: 100, stored: 200, buffered: 1, flushP95S: 0.01, queueDelayS: 0 },
      }),
    );
    expect(result.current).toBe(first);

    act(() =>
      benchmark.applyEvent({ run: summaryOf({ phase: 'waiting', elapsedMs: 3000 }), point: null }),
    );
    expect(result.current).not.toBe(first);
    expect(result.current.reason).toContain('waiting for the readings to be stored');
  });

  it('unlocks when the run ends', () => {
    const { result, benchmark } = setup();
    act(() => benchmark.applyEvent({ run: summaryOf(), point: null }));
    act(() =>
      benchmark.applyEvent({
        run: summaryOf({ phase: 'ended', outcome: 'stopped', elapsedMs: 30_000 }),
        point: null,
      }),
    );
    expect(result.current).toEqual({ locked: false, reason: null });
  });
});

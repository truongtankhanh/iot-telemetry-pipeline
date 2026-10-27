import { useCallback, useRef, useState } from 'react';
import { checksOf, startBenchmark, stopBenchmark } from '../../api/client';
import type { BenchmarkCheck, BenchmarkStartAnswer, StateView } from '../../api/types';
import { useBenchmarkStore } from '../../state/benchmarkContext';
import { useStudioStore } from '../../state/studioContext';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** An answer's state alone: the run is the benchmark store's, not part of what the Zustand store holds. */
function stateOf(answer: BenchmarkStartAnswer): StateView {
  const view: Partial<BenchmarkStartAnswer> = { ...answer };
  delete view.run;
  return view as StateView;
}

/**
 * Start and Stop of a benchmark, with what the page needs to show about them: which one is on its way, what the simulator said when it
 * refused, and the checks a refused start named. The answer to either is the new state, which goes into the store at once; the run
 * itself arrives through the stream, and the answer to a start also gives the benchmark store its first summary so that the page does
 * not wait for the first event to know that a run exists.
 *
 * A start can only be given by the caller that holds the size the person confirmed (`start(messages)`); nothing here sets it. A second
 * press of the same button while its request is out is ignored; Stop is never held back by a Start that is still out. **Stop answers when the run has ended**, which can take several seconds: `stopping` is true
 * that long, so the button can say "Stopping…" instead of sitting silent.
 */
export function useBenchmarkCommands() {
  const studio = useStudioStore();
  const benchmark = useBenchmarkStore();
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<readonly BenchmarkCheck[] | null>(null);
  // One ref for each: a Stop must not be swallowed because a Start is still out (the run may already exist on the simulator).
  const starts = useRef(false);
  const stops = useRef(false);

  /** Resolves true when the simulator accepted the start. */
  const start = useCallback(
    async (messages: number): Promise<boolean> => {
      if (starts.current) return false;
      starts.current = true;
      setStarting(true);
      setError(null);
      setRefused(null);
      try {
        const answer = await startBenchmark({ messages });
        benchmark.applyEvent({ run: answer.run, point: null });
        studio.getState().setView(stateOf(answer), Date.now());
        return true;
      } catch (failure) {
        setRefused(checksOf(failure));
        setError(message(failure));
        return false;
      } finally {
        starts.current = false;
        setStarting(false);
      }
    },
    [benchmark, studio],
  );

  /** Resolves true when the simulator stopped the run (or none was going to stop: its `409` says so, and is shown). */
  const stop = useCallback(async (): Promise<boolean> => {
    if (stops.current) return false;
    stops.current = true;
    setStopping(true);
    setError(null);
    try {
      studio.getState().setView(await stopBenchmark(), Date.now());
      return true;
    } catch (failure) {
      setError(message(failure));
      return false;
    } finally {
      stops.current = false;
      setStopping(false);
    }
  }, [studio]);

  const clearError = useCallback(() => {
    setError(null);
    setRefused(null);
  }, []);

  return { start, stop, starting, stopping, error, refused, clearError };
}

export type BenchmarkCommands = ReturnType<typeof useBenchmarkCommands>;

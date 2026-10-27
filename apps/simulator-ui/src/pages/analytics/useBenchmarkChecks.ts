import { useCallback, useEffect, useState } from 'react';
import { getBenchmarkPreflight } from '../../api/client';
import type { BenchmarkCheck } from '../../api/types';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface BenchmarkChecks {
  /** The three checks as the simulator last answered; empty before the first answer. */
  checks: readonly BenchmarkCheck[];
  /** The first answer is on its way, or the one asked for by `refresh` or by a change of `watch`. */
  loading: boolean;
  /** Why the checks could not be read ("Cannot reach the simulator"), or `null`. */
  error: string | null;
  /** Asks the simulator again. */
  refresh(): void;
}

/**
 * The pre-flight of a benchmark (`GET /api/benchmark/preflight`): ingest ready, database reachable, fleet paused. Read when the page opens,
 * on `refresh()` ("Check again") and whenever `watch` changes: the page passes what its checks depend on (the devices that run, the
 * scenarios that play, ingest's status), so the list turns green as soon as someone pauses the fleet, without a timer. Not read
 * while `enabled` is false (the benchmark is not available, or a run is going and the answer would mean nothing).
 *
 * The answer decides nothing by itself: the simulator checks again when a start arrives, and a start it refuses names the checks, which
 * the page shows instead of these (`useBenchmarkCommands().refused`). A request that is superseded is aborted, so an older answer
 * never overwrites a newer one.
 */
export function useBenchmarkChecks({
  enabled,
  watch,
}: {
  enabled: boolean;
  watch: string;
}): BenchmarkChecks {
  const [tick, setTick] = useState(0);
  const [answer, setAnswer] = useState<{
    key: string;
    checks: readonly BenchmarkCheck[];
    error: string | null;
  } | null>(null);
  const key = `${tick}|${watch}`;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getBenchmarkPreflight({ signal: controller.signal }).then(
      ({ checks }) => {
        if (!controller.signal.aborted) setAnswer({ key, checks, error: null });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setAnswer({ key, checks: [], error: message(error) });
      },
    );
    return () => controller.abort();
  }, [enabled, key]);

  const refresh = useCallback(() => setTick((was) => was + 1), []);

  return {
    checks: answer?.checks ?? [],
    // Derived, not set in the effect: the answer on show belongs to an earlier question until one for this key arrives.
    loading: enabled && (answer === null || answer.key !== key),
    error: answer?.error ?? null,
    refresh,
  };
}

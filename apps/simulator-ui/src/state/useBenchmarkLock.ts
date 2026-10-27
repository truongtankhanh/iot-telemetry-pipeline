import { useMemo } from 'react';
import { lockReason } from '../lib/benchmarkLock';
import { useBenchmarkStatus } from './benchmarkContext';

export interface BenchmarkLock {
  /** True while a benchmark runs: the commands that publish are refused by the simulator, and not sent from here. */
  locked: boolean;
  /** Why, in a sentence; `null` when nothing is locked. */
  reason: string | null;
}

/**
 * Whether the fleet's publishing controls are locked by a benchmark (decision Q5). It reads only the run's id and phase, so a
 * component that calls it does not render for each point of the series. The lock is the simulator's rule (it answers `409`);
 * this is how a control learns of it before the person presses it. It is never the enforcement: a stale tab that still shows a
 * button gets the simulator's own refusal.
 */
export function useBenchmarkLock(): BenchmarkLock {
  const status = useBenchmarkStatus();
  return useMemo(() => ({ locked: status !== null, reason: lockReason(status) }), [status]);
}

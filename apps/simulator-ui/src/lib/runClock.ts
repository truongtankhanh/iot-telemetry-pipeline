import type { EngineSnapshot, ScenarioRunView } from '../api/types';

/** The run of a scenario that is playing now, or `undefined`. */
export const runFor = (
  runs: readonly ScenarioRunView[],
  scenario: string,
): ScenarioRunView | undefined => runs.find((run) => run.scenario === scenario);

/**
 * Seconds into a scenario, from its start. The state holds a snapshot of the engine's anomaly clock (`elapsedS`, taken
 * at `nowMs`); on the wall clock the engine goes on after the snapshot, so the time since it is added. A stopped engine
 * and the simulated clock (which moves only on a step) do not advance by themselves. The answer is kept inside the
 * scenario, `0` to `lengthS`.
 */
export function scenarioElapsedS(
  run: Pick<ScenarioRunView, 'offsetS'>,
  engine: Pick<EngineSnapshot, 'elapsedS' | 'nowMs' | 'running' | 'simulated'>,
  now: number,
  lengthS: number,
): number {
  const sinceSnapshotS = engine.running && !engine.simulated ? (now - engine.nowMs) / 1000 : 0;
  const elapsed = engine.elapsedS - run.offsetS + Math.max(0, sinceSnapshotS);
  return Math.min(Math.max(elapsed, 0), lengthS);
}

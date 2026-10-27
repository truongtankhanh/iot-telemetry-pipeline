import type { BenchmarkPhase } from '../api/types';

/** What a phase of a run means, in words a person reads in a pill or a sentence. */
export const PHASE_WORDS: Record<BenchmarkPhase, string> = {
  starting: 'starting',
  publishing: 'publishing',
  waiting: 'waiting for the readings to be stored',
  ended: 'ended',
};

/** The run that is going, as the benchmark's holder says it (`BenchmarkStatus`). */
interface RunningRun {
  readonly id: number;
  readonly phase: BenchmarkPhase;
}

/**
 * Why the controls that publish are locked, or `null` when nothing is. The simulator refuses those commands itself while a
 * benchmark runs (`409`, "A benchmark is running; stop it first"); this is the same fact said before the button is pressed, once,
 * in the banner of every page, and in the answer of a command that is refused here without being sent.
 */
export function lockReason(run: RunningRun | null): string | null {
  if (run === null) return null;
  return `A benchmark is running (run ${run.id}, ${PHASE_WORDS[run.phase]}): the controls that publish are locked until it ends.`;
}

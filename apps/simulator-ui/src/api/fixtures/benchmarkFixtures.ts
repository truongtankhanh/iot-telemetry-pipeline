import type { BenchmarkDetail, BenchmarkPreflightAnswer } from '../types';
import rawDetail from './benchmark.json';
import rawPreflight from './benchmark-preflight.json';

/**
 * `benchmark.json` (a `GET /api/benchmark` body: run 3 going, publishing, with eleven points; run 2 completed with the
 * `--json` fields of the command line; run 1 failed) typed as the detail, for tests. The JSON reads a `null` among the numbers
 * of a series as a union, so the cast goes through `unknown` once, here, as `stateView.ts` does; a test clones it before
 * changing anything. The keys are checked from both sides: `client.test.ts` here and `control-routes.test.ts` in the simulator.
 */
export const benchmarkBody = rawDetail as unknown as { benchmark: BenchmarkDetail };
export const benchmarkFixture: BenchmarkDetail = benchmarkBody.benchmark;

/** `benchmark-preflight.json`: a `GET /api/benchmark/preflight` body with the three checks passing. */
export const benchmarkPreflightFixture = rawPreflight as unknown as BenchmarkPreflightAnswer;

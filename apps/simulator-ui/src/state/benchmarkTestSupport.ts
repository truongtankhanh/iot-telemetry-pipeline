/**
 * For the tests of the controls that a running benchmark locks: a `BenchmarkStore` that holds a run going (run 3, publishing) with the
 * series of the fixture, the way a window that has followed the stream would. Not a `*.test.ts`, so Vitest does not run it as a test file.
 */
import { benchmarkFixture } from '../api/fixtures/benchmarkFixtures';
import { BenchmarkStore } from './benchmarkStore';

export function runningBenchmark(): BenchmarkStore {
  const store = new BenchmarkStore();
  store.seedDetail(benchmarkFixture);
  return store;
}

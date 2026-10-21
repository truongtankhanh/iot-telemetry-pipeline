import { describe, expect, it } from 'vitest';
import type { ScenarioRunView } from '../api/types';
import { runFor, scenarioElapsedS } from './runClock';

const run = { offsetS: 10 };
const wall = { running: true, simulated: false, elapsedS: 51, nowMs: 1_000_000 };

describe('scenarioElapsedS', () => {
  it('is the anomaly clock minus where the run started', () => {
    expect(scenarioElapsedS(run, wall, wall.nowMs, 80)).toBe(41);
  });

  it('goes on after the snapshot on the wall clock', () => {
    expect(scenarioElapsedS(run, wall, wall.nowMs + 2500, 80)).toBe(43.5);
  });

  it('does not go back when the snapshot is newer than the clock of the page', () => {
    expect(scenarioElapsedS(run, wall, wall.nowMs - 5000, 80)).toBe(41);
  });

  it('does not advance by itself on the simulated clock, which moves only on a step', () => {
    expect(scenarioElapsedS(run, { ...wall, simulated: true }, wall.nowMs + 9000, 80)).toBe(41);
  });

  it('does not advance when the engine is not running', () => {
    expect(scenarioElapsedS(run, { ...wall, running: false }, wall.nowMs + 9000, 80)).toBe(41);
  });

  it('stays inside the scenario, from its start to its length', () => {
    expect(scenarioElapsedS(run, { ...wall, elapsedS: 5 }, wall.nowMs, 80)).toBe(0);
    expect(scenarioElapsedS(run, wall, wall.nowMs + 600_000, 80)).toBe(80);
  });
});

describe('runFor', () => {
  const runs: ScenarioRunView[] = [
    {
      id: 'r1',
      scenario: 'overheat',
      startedAt: '2026-10-21T08:00:00.000Z',
      offsetS: 0,
      endsAtS: 80,
      anomalyIds: ['a1'],
      startedDevices: [],
    },
  ];

  it('finds the run of a scenario that is playing, and nothing for another', () => {
    expect(runFor(runs, 'overheat')?.id).toBe('r1');
    expect(runFor(runs, 'crowded-lecture')).toBeUndefined();
    expect(runFor([], 'overheat')).toBeUndefined();
  });
});

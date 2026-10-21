import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EngineOptions } from './engine.ts';
import type { ObservationDraft } from './observation-store.ts';
import type { ScenarioDocument } from './scenario-document.ts';
import { ScenarioConflictError, ScenarioRuns } from './scenario-runs.ts';
import { parseAnomaly } from './signals.ts';
import { setupEngine, T0 } from './test-support.ts';

const overheat: ScenarioDocument = {
  name: 'overheat',
  description: '',
  anomalies: [
    { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2, startAt: 20, duration: 60 },
  ],
};
const both: ScenarioDocument = {
  name: 'both',
  description: '',
  anomalies: [
    { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29, startAt: 20, duration: 60 },
    { deviceId: 'lib-air-01', metric: 'co2_ppm', value: 1450, startAt: 10, duration: 30 },
  ],
};
const stuffy: ScenarioDocument = {
  name: 'stuffy',
  description: '',
  anomalies: [
    { deviceId: 'lib-air-01', metric: 'co2_ppm', value: 1450, startAt: 10, duration: 30 },
  ],
};
const broken: ScenarioDocument = {
  name: 'broken',
  description: '',
  anomalies: [
    { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29, startAt: 20, duration: 60 },
    { deviceId: 'ghost-01', metric: 'temperature_c', value: 1, startAt: 0, duration: 5 },
  ],
};

async function setup(options: Partial<EngineOptions> = {}) {
  const { engine } = setupEngine(options);
  await engine.start();
  const recorded: ObservationDraft[] = [];
  const runs = new ScenarioRuns({
    engine,
    record: (draft) => recorded.push(draft),
    now: () => T0 + 123,
  });
  /** Moves the simulated clock by `count` publish intervals (2 s each). */
  const step = async (count: number) => {
    for (let i = 0; i < count; i++) await engine.step();
  };
  const anomalyIds = () => engine.snapshot().anomalies.map((entry) => entry.id);
  return { engine, runs, recorded, step, anomalyIds };
}

describe('ScenarioRuns.run', () => {
  it('plays the scenario from now: its "20 s in" is 20 s after the call', async () => {
    const { engine, runs, recorded, step } = await setup();
    await step(5); // 10 s in

    const { run, replaced } = runs.run(both, { replace: false });

    assert.deepEqual(run, {
      id: 'r1',
      scenario: 'both',
      startedAt: '2026-10-01T05:00:00.123Z',
      offsetS: 10,
      endsAtS: 90,
      anomalyIds: ['a1', 'a2'],
      startedDevices: [],
    });
    assert.deepEqual(replaced, []);
    assert.deepEqual(
      engine.snapshot().anomalies.map((e) => [e.id, e.anomaly.startAt, e.anomaly.duration]),
      [
        ['a1', 30, 60],
        ['a2', 20, 30],
      ],
    );
    assert.deepEqual(recorded, [
      {
        kind: 'scenario-run',
        data: {
          name: 'both',
          anomalyIds: ['a1', 'a2'],
          offsetS: 10,
          // What the engine holds after the run, kept because a reset empties the engine.
          anomalies: [
            { id: 'a1', deviceId: 'dc-env-01', metric: 'temperature_c', startAt: 30, duration: 60 },
            { id: 'a2', deviceId: 'lib-air-01', metric: 'co2_ppm', startAt: 20, duration: 30 },
          ],
          runId: 'r1',
          startedDevices: [],
          replaced: [],
        },
      },
    ]);
    assert.deepEqual(runs.active(), [run]);
    assert.equal(runs.lastRunAt('both'), '2026-10-01T05:00:00.123Z');
    assert.equal(runs.lastRunAt('overheat'), null);
  });

  it('does not change the scenario it was given', async () => {
    const { runs, step } = await setup();
    await step(5);
    runs.run(overheat, { replace: false });
    assert.equal(overheat.anomalies[0]?.startAt, 20);
  });

  it('adds nothing and records nothing when one anomaly cannot be added', async () => {
    const { runs, recorded, anomalyIds } = await setup();
    assert.throws(() => runs.run(broken, { replace: false }), /ghost-01/);
    assert.deepEqual(anomalyIds(), []);
    assert.deepEqual(recorded, []);
    assert.deepEqual(runs.active(), []);
    assert.equal(runs.lastRunAt('broken'), null);
    // The failed attempt did not use up a run id.
    assert.equal(runs.run(overheat, { replace: false }).run.id, 'r1');
  });
});

describe('a run ending', () => {
  it('ends when the anomaly clock passes the end of its last anomaly', async () => {
    const { runs, step } = await setup();
    runs.run(overheat, { replace: false }); // 0 to 80 s
    await step(39); // 78 s
    assert.equal(runs.active().length, 1);
    await step(1); // 80 s
    assert.deepEqual(runs.active(), []);
    assert.ok(runs.lastRunAt('overheat') !== null, 'the last run is remembered after it ended');
  });

  it('ends on a reset', async () => {
    const { engine, runs } = await setup();
    runs.run(overheat, { replace: false });
    engine.reset();
    assert.deepEqual(runs.active(), []);
  });

  it('lasts while one of its anomalies is left, and ends with the last', async () => {
    const { engine, runs } = await setup();
    runs.run(both, { replace: false });
    engine.removeAnomaly('a1');
    assert.equal(runs.active().length, 1);
    engine.removeAnomaly('a2');
    assert.deepEqual(runs.active(), []);
  });
});

describe('ScenarioRuns.stop', () => {
  it('removes the anomalies of the run, ends it and records why', async () => {
    const { runs, recorded, anomalyIds } = await setup();
    const { run } = runs.run(overheat, { replace: false });

    assert.deepEqual(runs.stop('overheat'), run);

    assert.deepEqual(anomalyIds(), []);
    assert.deepEqual(runs.active(), []);
    assert.deepEqual(recorded.at(-1), {
      kind: 'scenario-stop',
      data: { name: 'overheat', runId: 'r1', anomalyIds: ['a1'], reason: 'stopped' },
    });
  });

  it('says nothing was running for a scenario that is not, or that already ended', async () => {
    const { runs, recorded, step } = await setup();
    assert.equal(runs.stop('overheat'), undefined);
    runs.run(overheat, { replace: false });
    await step(40);
    assert.equal(runs.stop('overheat'), undefined);
    assert.equal(recorded.filter((d) => d.kind === 'scenario-stop').length, 0);
  });

  it('stops only the scenario it was asked for', async () => {
    const { runs } = await setup();
    runs.run(overheat, { replace: false });
    runs.run(stuffy, { replace: false });
    runs.stop('overheat');
    assert.deepEqual(
      runs.active().map((run) => run.scenario),
      ['stuffy'],
    );
  });

  it('stops the newest run of a scenario that was run twice', async () => {
    const { runs, anomalyIds } = await setup();
    runs.run(overheat, { replace: false });
    runs.run(overheat, { replace: true });
    assert.equal(runs.stop('overheat')?.id, 'r2');
    assert.deepEqual(anomalyIds(), []);
  });
});

describe('a scenario that would play over another', () => {
  it('is refused with who is in the way, and nothing changes', async () => {
    const { runs, recorded, anomalyIds } = await setup();
    runs.run(overheat, { replace: false });

    assert.throws(
      () => runs.run(overheat, { replace: false }),
      (error: unknown) => {
        assert.ok(error instanceof ScenarioConflictError);
        assert.deepEqual(error.conflicts, [
          { deviceId: 'dc-env-01', anomalyId: 'a1', runId: 'r1', scenario: 'overheat' },
        ]);
        assert.match(error.message, /dc-env-01.*replace/);
        return true;
      },
    );

    assert.deepEqual(anomalyIds(), ['a1']);
    assert.equal(recorded.length, 1);
    assert.equal(runs.active().length, 1);
  });

  it('runs side by side with a scenario on other devices', async () => {
    const { runs } = await setup();
    runs.run(overheat, { replace: false });
    runs.run(stuffy, { replace: false });
    assert.deepEqual(
      runs.active().map((run) => run.id),
      ['r1', 'r2'],
    );
  });

  it('replaces the run in the way, whole, and says so in the observations', async () => {
    const { runs, recorded, anomalyIds } = await setup();
    runs.run(both, { replace: false }); // a1 on dc-env-01, a2 on lib-air-01

    const { run, replaced } = runs.run(overheat, { replace: true });

    // The whole of the old run goes, including its anomaly on a device the new one does not touch.
    assert.deepEqual(replaced, [{ runId: 'r1', scenario: 'both', anomalyIds: ['a1', 'a2'] }]);
    assert.deepEqual(anomalyIds(), ['a3']);
    assert.deepEqual(
      runs.active().map((r) => r.id),
      [run.id],
    );
    assert.deepEqual(
      recorded.map((draft) => draft.kind),
      ['scenario-run', 'scenario-stop', 'scenario-run'],
    );
    assert.deepEqual(recorded[1]?.data, {
      name: 'both',
      runId: 'r1',
      anomalyIds: ['a1', 'a2'],
      reason: 'replaced',
    });
    assert.deepEqual(recorded[2]?.data.replaced, replaced);
  });

  it('leaves the run in the way alone when the new scenario cannot be added', async () => {
    const { runs, anomalyIds } = await setup();
    runs.run(overheat, { replace: false });
    assert.throws(() => runs.run(broken, { replace: true }), /ghost-01/);
    assert.deepEqual(anomalyIds(), ['a1']);
    assert.deepEqual(
      runs.active().map((run) => run.id),
      ['r1'],
    );
  });

  it('counts an anomaly that no run owns: the one the command line started', async () => {
    const { runs, recorded, anomalyIds } = await setup({
      anomalies: [parseAnomaly('dc-env-01:temperature_c:29.2:20:60')],
    });
    assert.deepEqual(runs.conflicts(overheat), [
      { deviceId: 'dc-env-01', anomalyId: 'a1', runId: null, scenario: null },
    ]);
    assert.throws(() => runs.run(overheat, { replace: false }), ScenarioConflictError);

    const { replaced } = runs.run(overheat, { replace: true });

    assert.deepEqual(replaced, [{ runId: null, scenario: null, anomalyIds: ['a1'] }]);
    assert.deepEqual(anomalyIds(), ['a2']);
    // Only a run is stopped in the log; the engine's own `anomaly-removed` covers the loose one.
    assert.deepEqual(
      recorded.map((draft) => draft.kind),
      ['scenario-run'],
    );
  });

  it('counts an anomaly added by hand that has not started yet, but not one that has ended', async () => {
    const { engine, runs, step } = await setup();
    engine.addAnomaly({
      deviceId: 'dc-env-01',
      metric: 'temperature_c',
      value: 30,
      startAt: 0,
      duration: 10,
    });
    engine.addAnomaly({
      deviceId: 'dc-env-02',
      metric: 'temperature_c',
      value: 30,
      startAt: 100,
      duration: 10,
    });
    await step(6); // 12 s: the first ended, the second is still to come

    assert.equal(runs.conflicts(overheat).length, 0);
    assert.deepEqual(
      runs.conflicts({
        ...overheat,
        anomalies: [{ ...overheat.anomalies[0]!, deviceId: 'dc-env-02' }],
      }),
      [{ deviceId: 'dc-env-02', anomalyId: 'a2', runId: null, scenario: null }],
    );
    assert.doesNotThrow(() => runs.run(overheat, { replace: false }));
  });
});

describe('the devices a run starts', () => {
  it('starts the ones that are stopped or paused, and not the ones that run', async () => {
    const { engine, runs, recorded } = await setup();
    engine.stopDevice('dc-env-01');
    engine.pauseDevice('lib-air-01');

    const { run } = runs.run(both, { replace: false });

    assert.deepEqual(run.startedDevices, ['dc-env-01', 'lib-air-01']);
    assert.deepEqual(
      engine.snapshot().devices.map((d) => [d.id, d.state]),
      [
        ['dc-env-01', 'running'],
        ['dc-env-02', 'running'],
        ['lib-air-01', 'running'],
      ],
    );
    assert.deepEqual(recorded[0]?.data.startedDevices, ['dc-env-01', 'lib-air-01']);
  });

  it('lists only the device that was not running', async () => {
    const { engine, runs } = await setup();
    engine.stopDevice('lib-air-01');
    assert.deepEqual(runs.run(both, { replace: false }).run.startedDevices, ['lib-air-01']);
  });

  it('leaves them alone when the run is refused', async () => {
    const { engine, runs } = await setup();
    runs.run(overheat, { replace: false });
    engine.stopDevice('dc-env-01');
    assert.throws(() => runs.run(overheat, { replace: false }), ScenarioConflictError);
    assert.equal(engine.snapshot().devices.find((d) => d.id === 'dc-env-01')?.state, 'stopped');
  });

  it('keeps them running when the run is stopped', async () => {
    const { engine, runs } = await setup();
    engine.stopDevice('dc-env-01');
    runs.run(overheat, { replace: false });
    runs.stop('overheat');
    assert.equal(engine.snapshot().devices.find((d) => d.id === 'dc-env-01')?.state, 'running');
  });
});

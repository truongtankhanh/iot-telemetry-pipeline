import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  alertCause,
  CAUSE_SLACK_S,
  parseScenarioRun,
  type ScenarioRun,
  type ScenarioRunAnomaly,
} from './alert-cause.ts';
import type { ObservationEvent } from './observation-store.ts';

const RUN_AT = '2026-10-20T08:00:00.000Z';
const RUN_MS = Date.parse(RUN_AT);
const at = (secondsAfterRun: number) => new Date(RUN_MS + secondsAfterRun * 1000).toISOString();

/** A run made at engine second 100: its preset anomaly starts 20 s in (engine second 120), for 60 s. */
function anomaly(overrides: Partial<ScenarioRunAnomaly> = {}): ScenarioRunAnomaly {
  return {
    id: 'a1',
    deviceId: 'dc-env-01',
    metric: 'temperature_c',
    startAt: 120,
    duration: 60,
    ...overrides,
  };
}

function run(overrides: Partial<ScenarioRun> = {}): ScenarioRun {
  return {
    name: 'server-room-overheat',
    at: RUN_AT,
    offsetS: 100,
    anomalies: [anomaly()],
    ...overrides,
  };
}

const alert = (openedAfterRun: number, overrides: Record<string, string> = {}) => ({
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  openedAt: at(openedAfterRun),
  ...overrides,
});

const WALL = { simulated: false };

describe('alertCause', () => {
  it('names the scenario whose anomaly played on the alert’s device and metric', () => {
    assert.deepEqual(alertCause(alert(44), [run()], WALL), {
      scenario: 'server-room-overheat',
      startedAt: RUN_AT,
    });
  });

  it('claims nothing without a run: the CLI’s --scenario and a hand-added anomaly leave no run', () => {
    assert.equal(alertCause(alert(44), [], WALL), null);
  });

  it('claims nothing for another device or another metric', () => {
    assert.equal(alertCause(alert(44, { deviceId: 'dc-env-02' }), [run()], WALL), null);
    assert.equal(alertCause(alert(44, { metric: 'humidity_pct' }), [run()], WALL), null);
  });

  it('counts an alert from the start of the anomaly to its end plus the slack, and no earlier or later', () => {
    const start = 20; // the anomaly starts 20 s after the run
    const end = start + 60 + CAUSE_SLACK_S;
    assert.ok(alertCause(alert(start), [run()], WALL));
    assert.ok(alertCause(alert(end), [run()], WALL));
    assert.equal(alertCause(alert(start - 1), [run()], WALL), null);
    assert.equal(alertCause(alert(end + 1), [run()], WALL), null);
  });

  it('takes the newest run that matches', () => {
    const older = run({ name: 'older', at: at(-600) });
    const newer = run({ name: 'newer' });
    assert.equal(alertCause(alert(44), [older, newer], WALL)?.scenario, 'newer');
    // The older run's window is long over: only the newer one can claim it.
    assert.equal(alertCause(alert(44), [newer, older], WALL)?.scenario, 'newer');
  });

  it('matches any anomaly of a run that added several', () => {
    const many = run({
      anomalies: [anomaly({ deviceId: 'dc-env-02', id: 'a2' }), anomaly({ id: 'a1' })],
    });
    assert.ok(alertCause(alert(44), [many], WALL));
  });

  it('never claims on a simulated engine, whose clock has no relation to wall time', () => {
    assert.equal(alertCause(alert(44), [run()], { simulated: true }), null);
  });

  it('claims nothing for a run without anomalies (made before they were recorded) or with bad times', () => {
    assert.equal(alertCause(alert(44), [run({ anomalies: [] })], WALL), null);
    assert.equal(alertCause(alert(44), [run({ at: 'not a time' })], WALL), null);
    assert.equal(alertCause({ ...alert(44), openedAt: 'not a time' }, [run()], WALL), null);
  });
});

describe('parseScenarioRun', () => {
  const event = (data: Record<string, unknown>, kind: ObservationEvent['kind'] = 'scenario-run') =>
    ({ id: 1, at: RUN_AT, kind, data }) as ObservationEvent;

  it('reads a run with its anomalies and takes the time from the event', () => {
    assert.deepEqual(
      parseScenarioRun(
        event({ name: 'x', offsetS: 5, anomalyIds: ['a1'], anomalies: [anomaly()] }),
      ),
      { name: 'x', at: RUN_AT, offsetS: 5, anomalies: [anomaly()] },
    );
  });

  it('is undefined for another kind, a missing field or a bad type', () => {
    assert.equal(
      parseScenarioRun(event({ name: 'x', offsetS: 5, anomalies: [] }, 'delivery')),
      undefined,
    );
    assert.equal(parseScenarioRun(event({ offsetS: 5, anomalies: [] })), undefined);
    assert.equal(parseScenarioRun(event({ name: 'x', offsetS: '5', anomalies: [] })), undefined);
    // An observation from before anomalies were recorded has none: not a run it can match.
    assert.equal(parseScenarioRun(event({ name: 'x', offsetS: 5, anomalyIds: ['a1'] })), undefined);
  });

  it('drops a malformed anomaly and keeps the well-formed ones', () => {
    const parsed = parseScenarioRun(
      event({
        name: 'x',
        offsetS: 0,
        anomalies: [anomaly(), { id: 'a2' }, null, { ...anomaly(), duration: Number.NaN }],
      }),
    );
    assert.deepEqual(parsed?.anomalies, [anomaly()]);
  });
});

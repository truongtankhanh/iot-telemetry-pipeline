import { describe, expect, it } from 'vitest';
import scenariosFixture from '../api/fixtures/scenarios.json';
import { stateViewFixture } from '../api/fixtures/stateView';
import type {
  Expected,
  ExpectedAlert,
  ObservedAlert,
  ScenarioItem,
  ScenarioLibraryView,
} from '../api/types';
import { FLAG_LIMIT, type PhaseModel, scenarioPhases } from './scenarioPhases';

const [overheat] = (scenariosFixture as unknown as ScenarioLibraryView).scenarios as [ScenarioItem];

const STARTED = '2026-10-20T09:00:00.000Z';
const startedMs = Date.parse(STARTED);
const at = (secondsIn: number) => new Date(startedMs + secondsIn * 1000).toISOString();

const expectedAlert = (overrides: Partial<ExpectedAlert> = {}): ExpectedAlert => ({
  ruleId: 'server-room-hot',
  title: 'Server room temperature high',
  severity: 'high',
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  opensAtS: 24,
  opensMargin: false,
  clearsAtS: 80,
  clearsUncertain: false,
  ...overrides,
});

const available = (
  alerts: ExpectedAlert[],
  extra: Partial<Extract<Expected, { available: true }>> = {},
): Expected => ({
  available: true,
  intervalS: 2,
  horizonS: 90,
  alerts,
  quiet: [],
  series: [],
  ...extra,
});

/** The fixture's overheat (20 s in, 60 s long) with another `expected`; its horizon is 90 s as in the frame. */
const scenario = (expected: Expected = available([expectedAlert()])): ScenarioItem => ({
  ...overheat,
  expected,
});

const observed = (overrides: Partial<ObservedAlert> = {}): ObservedAlert => ({
  ...structuredClone(stateViewFixture.alerts.alerts[0] as ObservedAlert),
  deviceId: 'dc-env-01',
  ruleId: 'server-room-hot',
  status: 'open',
  openedAt: at(24),
  ...overrides,
});

const run = { startedAt: STARTED };

function model(input: Partial<Parameters<typeof scenarioPhases>[0]> = {}) {
  const result: PhaseModel = scenarioPhases({
    item: scenario(),
    run: undefined,
    elapsedS: null,
    alerts: [],
    ...input,
  });
  if (!result.available) throw new Error(`not available: ${result.reason}`);
  return result;
}

describe('the three phases', () => {
  it('are normal, the anomaly with its value, and recovery, in plain seconds from the start', () => {
    const { segments, totalS } = model();
    expect(totalS).toBe(90);
    expect(segments.map((s) => [s.id, s.label, s.detail])).toEqual([
      ['normal', 'Normal', '0–20 s'],
      ['anomaly', 'Anomaly', '29.2 °C · 20–80 s'],
      ['recovery', 'Recovery', '80–90 s'],
    ]);
    expect(segments.map((s) => Math.round(s.leftPct * 10) / 10)).toEqual([0, 22.2, 88.9]);
    expect(segments.map((s) => Math.round(s.widthPct * 10) / 10)).toEqual([22.2, 66.7, 11.1]);
  });

  it('leave out a phase of no length: no recovery when the clear comes with the end of the anomaly', () => {
    const { segments, totalS } = model({
      item: scenario(available([expectedAlert()], { horizonS: 80 })),
    });
    expect(totalS).toBe(80);
    expect(segments.map((s) => s.id)).toEqual(['normal', 'anomaly']);
  });

  it('say how many devices when several move, not one value', () => {
    const item = scenario();
    const many: ScenarioItem = {
      ...item,
      anomalies: [
        ...item.anomalies,
        { deviceId: 'lib-air-01', metric: 'co2_ppm', value: 1450, startAt: 10, duration: 30 },
      ],
    };
    const { segments } = model({ item: many });
    expect(segments[0]?.detail).toBe('0–10 s');
    expect(segments[1]?.detail).toBe('2 devices · 10–80 s');
  });

  it('count the horizon when the last clear comes after the anomaly, and never stop short of the anomaly', () => {
    expect(model({ item: scenario(available([expectedAlert()], { horizonS: 120 })) }).totalS).toBe(
      120,
    );
    expect(model({ item: scenario(available([expectedAlert()], { horizonS: 10 })) }).totalS).toBe(
      80,
    );
  });
});

describe('a scenario that is not running', () => {
  it('shows its phases and flags hollow, with no playhead', () => {
    const result = model();
    expect(result.elapsedS).toBeNull();
    expect(result.playheadPct).toBeNull();
    expect(result.playheadText).toBeNull();
    expect(result.happened).toBe('Not running');
    expect(result.next).toBe('Alert opens about 24 s');
    expect(result.flags.map((f) => [f.kind, f.atS, f.done])).toEqual([
      ['opens', 24, false],
      ['clears', 80, false],
    ]);
    expect(Math.round(result.flags[0]!.leftPct * 10) / 10).toBe(26.7);
    expect(Math.round(result.flags[1]!.leftPct * 10) / 10).toBe(88.9);
  });

  it('does not take an alert for its own even if one matches: it has not run', () => {
    expect(model({ alerts: [observed()] }).happened).toBe('Not running');
  });
});

describe('a scenario that is running', () => {
  it('has no alert yet before the time, and puts the playhead where the seconds are', () => {
    const result = model({ run, elapsedS: 10 });
    expect(result.happened).toBe('No alert yet');
    expect(result.next).toBe('Alert opens about 24 s');
    expect(result.playheadText).toBe('10 s');
    expect(Math.round((result.playheadPct ?? 0) * 10) / 10).toBe(11.1);
  });

  it('says the alert has not been seen once it is well past the time', () => {
    expect(model({ run, elapsedS: 27 }).happened).toBe('No alert yet');
    expect(model({ run, elapsedS: 29 }).happened).toBe('Alert not seen yet');
  });

  it('fills the opening flag and counts to the clear once the alert has opened', () => {
    const result = model({ run, elapsedS: 41, alerts: [observed()] });
    expect(result.happened).toBe('Alert opened 24 s ✓');
    expect(result.next).toBe('Alert clears about 80 s, in 39 s');
    expect(result.flags.map((f) => [f.kind, f.done])).toEqual([
      ['opens', true],
      ['clears', false],
    ]);
    expect(result.playheadText).toBe('41 s');
  });

  it('fills the clear flag when the alert has cleared', () => {
    const result = model({ run, elapsedS: 85, alerts: [observed({ status: 'cleared' })] });
    expect(result.happened).toBe('Alert opened 24 s ✓, cleared ✓');
    expect(result.next).toBe('Alert cleared');
    expect(result.flags.map((f) => f.done)).toEqual([true, true]);
  });

  it('reads the time the alert opened, not the time it was expected', () => {
    expect(model({ run, elapsedS: 50, alerts: [observed({ openedAt: at(28) })] }).happened).toBe(
      'Alert opened 28 s ✓',
    );
  });

  it('does not take for this run an alert of another device or rule, or one that opened before it', () => {
    for (const other of [
      observed({ deviceId: 'dc-env-02' }),
      observed({ ruleId: 'poor-air-quality' }),
      observed({ openedAt: at(-60) }),
    ]) {
      // 41 s is well past the 24 s the alert was expected at, so "not seen yet": it is not that alert.
      expect(model({ run, elapsedS: 41, alerts: [other] }).happened).toBe('Alert not seen yet');
      expect(model({ run, elapsedS: 10, alerts: [other] }).happened).toBe('No alert yet');
    }
  });

  it('allows for the clocks of ingest and the simulator being two seconds apart', () => {
    expect(
      model({ run, elapsedS: 10, alerts: [observed({ openedAt: at(-1.5) })] }).happened,
    ).toMatch(/^Alert opened/);
  });

  it('keeps the playhead inside the bar', () => {
    expect(model({ run, elapsedS: 500 }).playheadPct).toBe(100);
    expect(model({ run, elapsedS: -3 }).playheadPct).toBe(0);
  });
});

describe('the wording of a best case', () => {
  it('says "or later" for an opening so close to its line that it may be late', () => {
    const item = scenario(available([expectedAlert({ opensMargin: true })]));
    expect(model({ item }).next).toBe('Alert opens about 24 s or later');
    expect(model({ item }).flags[0]?.uncertain).toBe(true);
  });

  it('says "or later" for a clear that may take longer, and "not known" for one that may not come', () => {
    const later = scenario(available([expectedAlert({ clearsAtS: 110, clearsUncertain: true })]));
    expect(model({ item: later, run, elapsedS: 41, alerts: [observed()] }).next).toBe(
      'Alert clears about 110 s or later, in 69 s',
    );
    const never = scenario(available([expectedAlert({ clearsAtS: null })]));
    const result = model({ item: never, run, elapsedS: 41, alerts: [observed()] });
    expect(result.next).toBe('Alert: clear time not known');
    expect(result.flags.map((f) => f.kind)).toEqual(['opens']);
  });

  it('does not count down past the clear', () => {
    expect(model({ run, elapsedS: 85, alerts: [observed()] }).next).toBe(
      'Alert clears about 80 s, in 0 s',
    );
  });
});

describe('a scenario that raises no alert, or more than one', () => {
  it('says so, with the reason the rules give', () => {
    const none = scenario(
      available([], {
        quiet: [{ deviceId: 'dc-env-01', metric: 'temperature_c', why: 'no-rule' }],
      }),
    );
    expect(model({ item: none }).next).toBe('No rule watches temperature_c on dc-env-01');
    expect(model({ item: none, run, elapsedS: 5 }).happened).toBe('No alert is expected');
    expect(model({ item: none }).flags).toEqual([]);

    const flat = scenario(
      available([], {
        quiet: [{ deviceId: 'dc-env-01', metric: 'temperature_c', why: 'never-crosses' }],
      }),
    );
    expect(model({ item: flat }).next).toBe(
      'temperature_c on dc-env-01 never goes beyond a raise line',
    );

    expect(model({ item: scenario(available([])) }).next).toBe(
      'The rules are not expected to raise an alert',
    );
  });

  it('counts the alerts that have opened and names the one still to come', () => {
    const second = expectedAlert({
      ruleId: 'poor-air-quality',
      title: 'Poor air quality (CO₂)',
      deviceId: 'lib-air-01',
      opensAtS: 50,
      clearsAtS: 90,
    });
    const item = scenario(available([expectedAlert(), second]));
    const result = model({ item, run, elapsedS: 30, alerts: [observed()] });
    expect(result.happened).toBe('1 of 2 alerts opened');
    expect(result.next).toBe('Poor air quality (CO₂) opens about 50 s');
    expect(result.flags).toHaveLength(4);
  });

  it('draws the flags of the first alerts only, and still counts them all', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      expectedAlert({ ruleId: `r${i}`, title: `Rule ${i}`, opensAtS: 24 + i, clearsAtS: 80 + i }),
    );
    const result = model({ item: scenario(available(many)), run, elapsedS: 5 });
    expect(result.flags).toHaveLength(FLAG_LIMIT * 2);
    expect(result.happened).toBe('0 of 6 alerts opened');
  });
});

describe('when the simulator will not say', () => {
  it('gives its reason and no bar', () => {
    const item = scenario({ available: false, reason: 'cannot read rules.json (ENOENT)' });
    expect(scenarioPhases({ item, run: undefined, elapsedS: null, alerts: [] })).toEqual({
      available: false,
      reason: 'cannot read rules.json (ENOENT)',
    });
  });
});

describe('the description of the bar', () => {
  it('carries the phases, what has happened, what comes next and the time', () => {
    const { description } = model({ run, elapsedS: 41, alerts: [observed()] });
    expect(description).toContain(overheat.name);
    expect(description).toContain('normal 0–20 s');
    expect(description).toContain('anomaly 29.2 °C · 20–80 s');
    expect(description).toContain('recovery 80–90 s');
    expect(description).toContain('Alert opened 24 s ✓');
    expect(description).toContain('Alert clears about 80 s, in 39 s');
    expect(description).toContain('now at 41 s');
  });

  it('leaves the time out when the scenario is not running', () => {
    expect(model().description).not.toContain('now at');
  });
});

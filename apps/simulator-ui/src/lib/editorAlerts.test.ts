import { describe, expect, it } from 'vitest';
import expectationsFixture from '../api/fixtures/expectations.json';
import scenariosFixture from '../api/fixtures/scenarios.json';
import type { Expected, ExpectedAlert, ScenarioLibraryView } from '../api/types';
import { alertsView, quietNotes } from './editorAlerts';
import { expectationView } from './scenarioExpectation';

const alert = (over: Partial<ExpectedAlert> = {}): ExpectedAlert => ({
  ruleId: 'server-room-hot',
  title: 'Server room temperature high',
  severity: 'high',
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  opensAtS: 50,
  opensMargin: false,
  clearsAtS: 106,
  clearsUncertain: false,
  ...over,
});

const available = (
  alerts: ExpectedAlert[],
  over: Partial<Extract<Expected, { available: true }>> = {},
) =>
  ({
    available: true,
    intervalS: 2,
    horizonS: 120,
    alerts,
    quiet: [],
    series: [],
    ...over,
  }) as Extract<Expected, { available: true }>;

describe('alertsView', () => {
  it('says nothing while the simulator is being asked', () => {
    expect(alertsView(null, 60)).toEqual({ rows: [], empty: null, basis: null, notes: [] });
  });

  it('gives the simulator’s reason when it cannot say, without a made-up row', () => {
    const view = alertsView({ available: false, reason: 'rules.json could not be read' }, 60);
    expect(view.rows).toEqual([]);
    expect(view.empty).toBe('Expected alerts are not available: rules.json could not be read.');
  });

  it('says no alert is expected for an empty list', () => {
    const view = alertsView(available([]), 60);
    expect(view.empty).toBe('No alert is expected.');
    expect(view.basis).toMatch(/Worked out from the rules and the 2 s publish interval/);
  });

  it('words each alert with the simulator’s times and orders them by when they open', () => {
    const view = alertsView(
      available([
        alert({ deviceId: 'dc-env-02', opensAtS: 80, clearsAtS: 100 }),
        alert({ opensAtS: 50, clearsAtS: 106 }),
      ]),
      120,
    );
    expect(view.empty).toBeNull();
    expect(view.rows.map((r) => [r.deviceId, r.raised, r.clears, r.afterEnd])).toEqual([
      ['dc-env-01', 'about 50 s', 'about 106 s', false],
      ['dc-env-02', 'about 80 s', 'about 100 s', false],
    ]);
  });

  it('says “or later” for a clear that may take longer and “not known” for one that was not found', () => {
    const view = alertsView(
      available([
        alert({ clearsUncertain: true }),
        alert({ deviceId: 'dc-env-02', opensAtS: 60, clearsAtS: null }),
      ]),
      200,
    );
    expect(view.rows[0]?.clears).toBe('about 106 s or later');
    expect(view.rows[1]?.clears).toBe('clear time not known');
  });

  it('says when an alert opens or clears after the scenario ends', () => {
    const view = alertsView(
      available([
        alert({ opensAtS: 116, clearsAtS: 190 }),
        alert({ deviceId: 'b', opensAtS: 10, clearsAtS: 90 }),
      ]),
      80,
    );
    const late = view.rows.find((r) => r.deviceId === 'dc-env-01');
    expect(late?.raised).toBe('about 116 s, after the scenario ends');
    expect(late?.clears).toBe('about 190 s, after the scenario ends');
    expect(late?.afterEnd).toBe(true);
    expect(view.rows.find((r) => r.deviceId === 'b')?.afterEnd).toBe(true); // clears at 90 > 80
  });

  it('works on the simulator’s own answer', () => {
    const body = expectationsFixture as unknown as { expected: Expected };
    const view = alertsView(body.expected, 80);
    if (body.expected.available) expect(view.rows).toHaveLength(body.expected.alerts.length);
  });
});

describe('quietNotes', () => {
  it('has the notes the scenario cards have, word for word', () => {
    const library = scenariosFixture as unknown as ScenarioLibraryView;
    for (const item of library.scenarios) {
      if (!item.expected.available) continue;
      expect(quietNotes(item.expected), item.name).toEqual(expectationView(item).notes);
    }
  });

  it('names a margin, a clear that may not come and an anomaly no rule watches', () => {
    const notes = quietNotes(
      available([alert({ opensMargin: true, clearsAtS: null })], {
        quiet: [
          { deviceId: 'hub-power-01', metric: 'power_kw', why: 'no-rule' },
          { deviceId: 'dc-env-02', metric: 'temperature_c', why: 'never-crosses' },
        ],
      }),
    );
    expect(notes).toEqual([
      'Server room temperature high is so close to its raise line that it may open later, or not at all.',
      'Server room temperature high may not clear while the baseline stays near its daily peak.',
      'No rule watches power_kw on hub-power-01.',
      'temperature_c on dc-env-02 never goes beyond a raise line.',
    ]);
  });
});

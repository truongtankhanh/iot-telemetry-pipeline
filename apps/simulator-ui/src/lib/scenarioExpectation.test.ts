import { describe, expect, it } from 'vitest';
import scenariosFixture from '../api/fixtures/scenarios.json';
import type { Expected, ExpectedAlert, ScenarioItem, ScenarioLibraryView } from '../api/types';
import {
  chartDescription,
  expectationView,
  scenarioChips,
  scenarioMeta,
  seconds,
} from './scenarioExpectation';

const [overheat, lecture, afternoon] = (scenariosFixture as unknown as ScenarioLibraryView)
  .scenarios as [ScenarioItem, ScenarioItem, ScenarioItem];

const alert = (overrides: Partial<ExpectedAlert> = {}): ExpectedAlert => ({
  ruleId: 'r',
  title: 'Rule title',
  severity: 'high',
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  opensAtS: 24,
  opensMargin: false,
  clearsAtS: 80,
  clearsUncertain: false,
  ...overrides,
});

/** The fixture's first scenario with another `expected`. */
const withExpected = (expected: Expected, extra: Partial<ScenarioItem> = {}): ScenarioItem => ({
  ...overheat,
  expected,
  ...extra,
});
const available = (
  alerts: ExpectedAlert[],
  quiet: Extract<Expected, { available: true }>['quiet'] = [],
): Expected => ({ available: true, intervalS: 2, horizonS: 80, alerts, quiet, series: [] });

describe('seconds', () => {
  it('writes plain seconds, with a decimal only when the time has one', () => {
    expect(seconds(24)).toBe('24 s');
    expect(seconds(110)).toBe('110 s');
    expect(seconds(22.5)).toBe('22.5 s');
    expect(seconds(0)).toBe('0 s');
  });
});

describe('scenarioMeta', () => {
  it('says the source, how many anomalies and how long, as the frame does', () => {
    expect(scenarioMeta(overheat)).toBe('built-in · 1 anomaly · 80 s');
    expect(scenarioMeta(afternoon)).toBe('custom · 3 anomalies · 100 s');
  });

  it('marks a scenario imported during the session', () => {
    expect(scenarioMeta({ ...afternoon, imported: true })).toBe(
      'custom · imported · 3 anomalies · 100 s',
    );
  });
});

describe('scenarioChips', () => {
  it('gives the device and what the metric is moved to for one anomaly', () => {
    expect(scenarioChips(overheat)).toEqual(['dc-env-01', 'temperature_c → 29.2']);
  });

  it('gives the devices, once each, for several', () => {
    expect(scenarioChips(afternoon)).toEqual(['hub-power-01', 'dc-env-01', 'lha-air-01']);
  });

  it('gives six devices and "+ n" for more', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...overheat.anomalies[0]!,
      deviceId: `dev-${i}`,
    }));
    expect(scenarioChips({ ...overheat, anomalies: many })).toEqual([
      'dev-0',
      'dev-1',
      'dev-2',
      'dev-3',
      'dev-4',
      'dev-5',
      '+ 3',
    ]);
  });
});

describe('expectationView', () => {
  it('says the frame sentence for server-room-overheat', () => {
    expect(expectationView(overheat)).toEqual({
      kind: 'alerts',
      before: 'Raises ',
      strong: 'Server room temperature high',
      after: ' (high) about 24 s; clears about 80 s.',
      notes: [],
    });
  });

  it('says "or later" when the clear is uncertain, as for CO₂ near its daily peak', () => {
    const view = expectationView(lecture);
    expect(view.strong).toBe('Poor air quality (CO₂)');
    expect(view.after).toBe(' (medium) about 24 s; clears about 110 s or later.');
  });

  it('says the clear time is not known, and why, when no clear was found', () => {
    const view = expectationView(
      withExpected(available([alert({ clearsAtS: null, clearsUncertain: true })])),
    );
    expect(view.after).toBe(' (high) about 24 s; clear time not known.');
    expect(view.notes).toEqual([
      'Rule title may not clear while the baseline stays near its daily peak.',
    ]);
  });

  it('warns of a breach too close to the raise line', () => {
    const view = expectationView(withExpected(available([alert({ opensMargin: true })])));
    expect(view.notes).toEqual([
      'Rule title is so close to its raise line that it may open later, or not at all.',
    ]);
  });

  it('lists the severities of two or three alerts in the order they open', () => {
    const view = expectationView(afternoon);
    expect(view.before).toBe('Raises 2 alerts: ');
    expect(view.strong).toBe('');
    expect(view.after).toBe('low, high.');
    expect(view.notes).toEqual(['No rule watches temperature_c on lha-air-01.']);
    const three = expectationView(
      withExpected(
        available([
          alert({ severity: 'low' }),
          alert({ severity: 'high' }),
          alert({ severity: 'medium' }),
        ]),
      ),
    );
    expect(three.before + three.after).toBe('Raises 3 alerts: low, high, medium.');
  });

  it('counts more than three alerts by severity, worst first', () => {
    const severities = ['medium', 'low', 'high', 'medium', 'low', 'high', 'high'] as const;
    const view = expectationView(
      withExpected(available(severities.map((severity) => alert({ severity })))),
    );
    expect(view.before + view.after).toBe('Raises 7 alerts: high 3, medium 2, low 2.');
  });

  it('says it raises no alert, and why, when the anomalies are quiet', () => {
    const view = expectationView(
      withExpected(
        available(
          [],
          [
            { deviceId: 'lib-air-01', metric: 'temperature_c', why: 'no-rule' },
            { deviceId: 'dc-env-01', metric: 'temperature_c', why: 'never-crosses' },
          ],
        ),
      ),
    );
    expect(view).toEqual({
      kind: 'none',
      before: 'Raises no alert.',
      strong: '',
      after: '',
      notes: [
        'No rule watches temperature_c on lib-air-01.',
        'temperature_c on dc-env-01 never goes beyond a raise line.',
      ],
    });
  });

  it('gives the reason, and no guess, when the rules are not available', () => {
    const view = expectationView(
      withExpected({ available: false, reason: 'cannot read rules.json (ENOENT)' }),
    );
    expect(view).toEqual({
      kind: 'unavailable',
      before: 'Expected alerts are not available: ',
      strong: '',
      after: 'cannot read rules.json (ENOENT).',
      notes: [],
    });
  });

  it('does not add a second full stop to a reason that ends with one', () => {
    const view = expectationView(withExpected({ available: false, reason: 'No file.' }));
    expect(view.after).toBe('No file.');
  });
});

describe('chartDescription', () => {
  it('says the anomaly, the alert and the clear, as the frame does', () => {
    expect(chartDescription(overheat, null)).toBe(
      'server-room-overheat: dc-env-01 temperature_c held at 29.2 from 20 s for 60 s; alert expected at 24 s, clears at 80 s',
    );
  });

  it('adds where the playhead is while the scenario runs', () => {
    expect(chartDescription(overheat, 41)).toBe(
      'server-room-overheat: dc-env-01 temperature_c held at 29.2 from 20 s for 60 s; alert expected at 24 s, clears at 80 s; now at 41 s',
    );
  });

  it('names the shape of a ramp and a spike', () => {
    const ramp = {
      ...overheat,
      anomalies: [{ ...overheat.anomalies[0]!, shape: 'ramp' as const }],
    };
    expect(chartDescription(ramp, null)).toContain('temperature_c rising to 29.2 from 20 s');
    const spike = {
      ...overheat,
      anomalies: [{ ...overheat.anomalies[0]!, shape: 'spike' as const }],
    };
    expect(chartDescription(spike, null)).toContain('temperature_c spiking to 29.2 from 20 s');
  });

  it('lists every anomaly of a longer scenario and counts its alerts', () => {
    const text = chartDescription(afternoon, null);
    expect(text).toContain('hub-power-01 power_kw held at 190 from 10 s for 55 s');
    expect(text).toContain('lha-air-01 temperature_c held at 30 from 60 s for 40 s');
    expect(text).toContain('2 alerts expected, the first at 12 s');
  });

  it('says so when there is no alert, an uncertain clear, or no rules', () => {
    expect(chartDescription(withExpected(available([])), null)).toContain('no alert expected');
    expect(chartDescription(lecture, null)).toContain(
      'alert expected at 24 s, clears at 110 s or later',
    );
    expect(chartDescription(withExpected(available([alert({ clearsAtS: null })])), null)).toContain(
      'alert expected at 24 s, clear time not known',
    );
    expect(chartDescription(withExpected({ available: false, reason: 'x' }), null)).toContain(
      'expected alerts are not available',
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { RuleInfo, ScenarioItem } from '../api/types';
import { DEMO_TOKENS } from './demoScript';
import { type DemoFacts, fillText, NARRATION_S_PER_STEP, scriptLine } from './demoText';

const rule: RuleInfo = {
  id: 'server-room-hot',
  kind: 'server_room',
  metric: 'temperature_c',
  direction: 'above',
  raise: 27,
  clear: 25.5,
  for: 3,
  severity: 'high',
  title: 'Server room temperature high',
};

const scenario = {
  name: 'server-room-overheat',
  anomalies: [
    { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2, startAt: 20, duration: 60 },
    { deviceId: 'dc-env-02', metric: 'humidity_pct', value: 80, startAt: 5, duration: 10 },
  ],
} as unknown as ScenarioItem;

const subject = { deviceId: 'dc-env-01', metric: 'temperature_c', ruleId: 'server-room-hot' };

const facts = (overrides: Partial<DemoFacts> = {}): DemoFacts => ({
  devices: 4,
  rate: 2,
  rule,
  scenario,
  subject,
  ...overrides,
});

const NOTHING: DemoFacts = { devices: null, rate: null, rule: null, scenario: null, subject };

describe('fillText', () => {
  it('fills every token from the facts', () => {
    const text = (token: string) => fillText(`{${token}}`, facts());
    expect(text('devices')).toBe('4 devices');
    expect(text('rate')).toBe('2.0 msg/s');
    expect(text('rule.raise')).toBe('27 °C');
    expect(text('rule.clear')).toBe('25.5 °C');
    expect(text('rule.for')).toBe('3');
    expect(text('rule.metric')).toBe('temperature_c');
    expect(text('device')).toBe('dc-env-01');
    expect(text('value')).toBe('29.2 °C');
    expect(text('duration')).toBe('60 s');
    expect(text('scenario')).toBe('server-room-overheat');
  });

  it('writes the frame’s lines', () => {
    expect(fillText('{devices}, {rate}', facts())).toBe('4 devices, 2.0 msg/s');
    expect(fillText('Raise {rule.raise}, clear {rule.clear}, {rule.for} in a row', facts())).toBe(
      'Raise 27 °C, clear 25.5 °C, 3 in a row',
    );
    expect(fillText('{device} → {value} for {duration}', facts())).toBe(
      'dc-env-01 → 29.2 °C for 60 s',
    );
  });

  it('says a single device in the singular', () => {
    expect(fillText('{devices}', facts({ devices: 1 }))).toBe('1 device');
  });

  it('gives a plain fallback for every token whose fact is missing, never undefined or NaN', () => {
    for (const token of DEMO_TOKENS) {
      if (token === 'device') continue; // the subject is always known
      const filled = fillText(`{${token}}`, NOTHING);
      expect(filled).not.toMatch(/undefined|NaN|null|\{/);
      expect(filled.length).toBeGreaterThan(0);
    }
    expect(fillText('Raise {rule.raise}', NOTHING)).toBe('Raise the raise line');
  });

  it('gives a fallback for a rate that is not a finite number', () => {
    expect(fillText('{rate}', facts({ rate: Number.NaN }))).toBe('the current rate');
    expect(fillText('{rate}', facts({ rate: Infinity }))).toBe('the current rate');
  });

  it('reads the value and the duration only from the subject’s own anomaly', () => {
    const other = { ...scenario, anomalies: [scenario.anomalies[1]!] } as unknown as ScenarioItem;
    expect(fillText('{value} {duration}', facts({ scenario: other }))).toBe('the value a while');
  });

  it('writes a metric with no unit without a trailing space', () => {
    const odd = { ...rule, metric: 'luminosity', raise: 5 } as unknown as RuleInfo;
    expect(fillText('{rule.raise}', facts({ rule: odd }))).toBe('5');
  });

  it('writes parts per million whole and the rest with one decimal', () => {
    const co2 = {
      ...scenario,
      anomalies: [
        { deviceId: 'dc-env-01', metric: 'co2_ppm', value: 1450.4, startAt: 0, duration: 90 },
      ],
    } as unknown as ScenarioItem;
    expect(
      fillText('{value}', facts({ scenario: co2, subject: { ...subject, metric: 'co2_ppm' } })),
    ).toBe('1450 ppm');
  });

  it('leaves braces that are not a known token as they are', () => {
    expect(fillText('{ spaced } {Upper} {unknown.thing} {}', facts())).toBe(
      '{ spaced } {Upper} {unknown.thing} {}',
    );
  });

  it('fills a token each time it appears', () => {
    expect(fillText('{device} and {device}', facts())).toBe('dc-env-01 and dc-env-01');
  });
});

describe('scriptLine', () => {
  const six = { id: 'overheat-to-incident', steps: [1, 2, 3, 4, 5, 6] };

  it('says the frame’s line: the script, its steps and about how long', () => {
    // 80 s of scenario + 6 steps of narration = 200 s: about 4 min
    expect(scriptLine(six, { lengthS: 80 })).toBe(
      'Script: overheat-to-incident · 6 steps · about 4 min',
    );
  });

  it('follows the scenario’s length and the narration allowance', () => {
    expect(NARRATION_S_PER_STEP).toBe(20);
    expect(scriptLine(six, { lengthS: 600 })).toContain('about 12 min');
    expect(scriptLine(six, { lengthS: 0 })).toContain('about 2 min');
  });

  it('leaves the time out until the scenario is known, and says one step in the singular', () => {
    expect(scriptLine(six, null)).toBe('Script: overheat-to-incident · 6 steps');
    expect(scriptLine({ id: 'one', steps: [1] }, null)).toBe('Script: one · 1 step');
  });

  it('is never under a minute', () => {
    expect(scriptLine({ id: 'tiny', steps: [] }, { lengthS: 1 })).toContain('about 1 min');
  });
});

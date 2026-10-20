import { describe, expect, it } from 'vitest';
import type { PagedAlert, RuleInfo, RulesView } from '../api/types';
import type { Sample } from '../state/history';
import { alertWhy, ruleOf } from './alertWhy';

const OPENED = Date.parse('2026-10-20T08:00:26.000Z');

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

const alert = (overrides: Partial<PagedAlert> = {}): PagedAlert => ({
  id: '7',
  deviceId: 'dc-env-01',
  ruleId: 'server-room-hot',
  metric: 'temperature_c',
  severity: 'high',
  title: 'Server room temperature high',
  status: 'open',
  openedAt: new Date(OPENED).toISOString(),
  openedValue: 29.3,
  clearedAt: null,
  clearedValue: null,
  externalRef: null,
  deliveryStatus: 'pending',
  deliveryAttempts: 0,
  deliveryError: null,
  preexisting: false,
  observed: {
    openedAt: null,
    clearedAt: null,
    delivered: { opened: null, cleared: null },
    incident: null,
  },
  cause: null,
  ...overrides,
});

/** Readings every 2 s, the last one at the moment the alert opened. */
const series = (...values: number[]): Sample[] =>
  values.map((v, i) => ({ t: OPENED - (values.length - 1 - i) * 2000, v }));

describe('ruleOf', () => {
  const rules: RulesView = { available: true, reason: null, items: [rule] };

  it('finds the rule by id, and is null for an unknown one or when rules are not available', () => {
    expect(ruleOf(rules, alert())).toBe(rule);
    expect(ruleOf(rules, alert({ ruleId: 'ghost' }))).toBeNull();
    expect(ruleOf({ available: false, reason: 'no rules file', items: [] }, alert())).toBeNull();
  });
});

describe('alertWhy', () => {
  it('names the rule’s line and the breaching readings that led to the alert', () => {
    const why = alertWhy({ alert: alert(), rule, series: series(25.1, 29.2, 29.4, 29.3) });
    expect(why.text).toBe(
      'dc-env-01 temperature_c was above 27 °C for 3 readings in a row (29.2, 29.4, 29.3).',
    );
    expect(why.readings).toEqual([29.2, 29.4, 29.3]);
  });

  it('uses only the readings up to the moment ingest opened the alert', () => {
    const later = [...series(25.1, 29.2, 29.4, 29.3), { t: OPENED + 2000, v: 31 }];
    expect(alertWhy({ alert: alert(), rule, series: later }).readings).toEqual([29.2, 29.4, 29.3]);
  });

  it('falls back to the value ingest stored when Studio holds too few breaching readings', () => {
    const why = alertWhy({ alert: alert(), rule, series: series(25.1, 29.2, 29.3) });
    expect(why.text).toBe(
      'dc-env-01 temperature_c was above 27 °C for 3 readings in a row. It opened at 29.3 °C. Studio did not record the readings that led to it.',
    );
    expect(why.readings).toEqual([]);
  });

  it('does not make up readings when it holds none, and omits the value when ingest has none', () => {
    const why = alertWhy({ alert: alert({ openedValue: null }), rule, series: [] });
    expect(why.text).toBe(
      'dc-env-01 temperature_c was above 27 °C for 3 readings in a row. Studio did not record the readings that led to it.',
    );
  });

  it('says "below" for a rule that opens under its line, and a single reading without "in a row"', () => {
    const low: RuleInfo = { ...rule, direction: 'below', raise: 10, clear: 12, for: 1 };
    const why = alertWhy({ alert: alert({ openedValue: 9 }), rule: low, series: series(9) });
    expect(why.text).toBe('dc-env-01 temperature_c was below 10 °C (9.0).');
  });

  it('still explains an alert whose rule Studio does not have, without inventing thresholds', () => {
    const why = alertWhy({ alert: alert(), rule: null, series: series(29.3) });
    expect(why.text).toBe(
      "Rule server-room-hot raised it on dc-env-01, temperature_c 29.3 °C. The rule's thresholds are not available to Studio.",
    );
    expect(why.readings).toEqual([]);
  });

  it('names the scenario only when the simulator did, and never otherwise', () => {
    const named = alertWhy({
      alert: alert({
        cause: { scenario: 'server-room-overheat', startedAt: '2026-10-20T08:00:00.000Z' },
      }),
      rule,
      series: [],
    });
    expect(named.cause).toBe('Injected by the scenario server-room-overheat started in Studio.');

    const none = alertWhy({ alert: alert(), rule, series: series(29.2, 29.4, 29.3) });
    expect(none.cause).toBeNull();
    expect(none.text).not.toMatch(/scenario|Studio started|injected/i);
  });

  it('survives an alert time it cannot read', () => {
    const why = alertWhy({ alert: alert({ openedAt: 'not a time' }), rule, series: series(29.3) });
    expect(why.readings).toEqual([]);
  });
});

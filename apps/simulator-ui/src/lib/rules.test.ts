import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { RuleInfo, RulesView } from '../api/types';
import {
  formatAmount,
  formatValue,
  headroom,
  isBeyond,
  rangeOf,
  ruleSentence,
  rulesFor,
} from './rules';

const rules = fixture.rules;
const device = (id: string) => {
  const found = fixture.devices.find((d) => d.id === id);
  if (!found) throw new Error(`no device ${id}`);
  return found;
};
const hot = rules.items.find((r) => r.id === 'server-room-hot') as RuleInfo;
const below: RuleInfo = { ...hot, id: 'cold', direction: 'below', raise: 18, clear: 20 };

describe('rulesFor', () => {
  it('finds the rules of the device kind for the metric', () => {
    expect(rulesFor(rules, device('dc-env-01'), 'temperature_c').map((r) => r.id)).toEqual([
      'server-room-hot',
    ]);
    expect(rulesFor(rules, device('lib-air-01'), 'co2_ppm').map((r) => r.id)).toEqual([
      'indoor-co2',
    ]);
  });

  it('finds nothing for a metric without a rule, or a device kind without one', () => {
    expect(rulesFor(rules, device('lib-air-01'), 'temperature_c')).toEqual([]);
    expect(rulesFor(rules, device('hub-power-01'), 'temperature_c')).toEqual([]);
  });

  it('finds nothing when the rules are not available', () => {
    const none: RulesView = { available: false, reason: 'cannot read', items: [] };
    expect(rulesFor(none, device('dc-env-01'), 'temperature_c')).toEqual([]);
    const lying: RulesView = { available: false, reason: 'x', items: rules.items };
    expect(rulesFor(lying, device('dc-env-01'), 'temperature_c')).toEqual([]);
  });
});

describe('isBeyond', () => {
  it('is strict: the raise line itself is not a breach', () => {
    expect(isBeyond(hot, 27)).toBe(false);
    expect(isBeyond(hot, 27.1)).toBe(true);
    expect(isBeyond(hot, 20)).toBe(false);
  });

  it('turns around for a rule that fires below a value', () => {
    expect(isBeyond(below, 18)).toBe(false);
    expect(isBeyond(below, 17.9)).toBe(true);
    expect(isBeyond(below, 25)).toBe(false);
  });
});

describe('headroom', () => {
  it('says how far above the raise line a value is', () => {
    expect(headroom(hot, 29.3)).toMatchObject({ beyond: true, text: '2.3 °C above raise' });
  });

  it('says how far a value is from the raise line', () => {
    expect(headroom(hot, 22.4)).toMatchObject({ beyond: false, text: '4.6 °C to raise' });
  });

  it('uses the unit of the metric and whole numbers for big amounts', () => {
    const co2 = rules.items.find((r) => r.id === 'indoor-co2') as RuleInfo;
    expect(headroom(co2, 702).text).toBe('498 ppm to raise');
    expect(headroom(co2, 1450).text).toBe('250 ppm above raise');
    const humid = rules.items.find((r) => r.id === 'server-room-humid') as RuleInfo;
    expect(headroom(humid, 45.1).text).toBe('14.9 % to raise');
  });

  it('reads a rule that fires below a value', () => {
    expect(headroom(below, 17).text).toBe('1 °C below raise');
    expect(headroom(below, 21).text).toBe('3 °C to raise');
  });

  it('is at the line, not beyond it, when the value equals the raise line', () => {
    expect(headroom(hot, 27)).toMatchObject({ beyond: false, amount: 0, text: '0 °C to raise' });
  });
});

describe('formatAmount and formatValue', () => {
  it('rounds to one decimal under 100 and to whole numbers above, without a trailing .0', () => {
    expect(formatAmount(2.3000000000000007)).toBe('2.3');
    expect(formatAmount(4)).toBe('4');
    expect(formatAmount(99.96)).toBe('100');
    expect(formatAmount(498.4)).toBe('498');
    expect(formatAmount(-3.25)).toBe('3.3');
  });

  it('shows ppm whole and the other metrics with one decimal', () => {
    expect(formatValue('co2_ppm', 702.4)).toBe('702');
    expect(formatValue('temperature_c', 22.4)).toBe('22.4');
    expect(formatValue('power_kw', 142)).toBe('142.0');
  });
});

describe('ruleSentence', () => {
  it('names the lines and how many readings in a row open the alert', () => {
    expect(ruleSentence(hot)).toBe('raise 27 · clear 25.5 · opens after 3 readings in a row');
  });

  it('says "1 reading" for a rule that opens at once', () => {
    expect(ruleSentence({ ...hot, for: 1 })).toBe('raise 27 · clear 25.5 · opens after 1 reading');
  });
});

describe('rangeOf', () => {
  it('is the contract range of a metric', () => {
    expect(rangeOf('humidity_pct')).toEqual({ unit: '%', min: 0, max: 100 });
    expect(rangeOf('temperature_c')).toEqual({ unit: '°C', min: -40, max: 85 });
  });

  it('is null for a metric the contract does not have, including names inherited from Object', () => {
    expect(rangeOf('pressure_hpa')).toBeNull();
    expect(rangeOf('constructor')).toBeNull();
  });
});

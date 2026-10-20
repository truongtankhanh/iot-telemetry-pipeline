import { describe, expect, it } from 'vitest';
import { holdRangeHint, MAX_INTERVAL_MS, parseHoldValue, parseIntervalMs } from './hold';

describe('holdRangeHint', () => {
  it('is the contract range with its unit', () => {
    expect(holdRangeHint('temperature_c')).toBe('-40 to 85 °C');
    expect(holdRangeHint('humidity_pct')).toBe('0 to 100 %');
    expect(holdRangeHint('co2_ppm')).toBe('0 to 10000 ppm');
  });

  it('is empty for a metric the contract lacks', () => {
    expect(holdRangeHint('pressure_hpa')).toBe('');
  });
});

describe('parseHoldValue', () => {
  it('reads a number inside the range', () => {
    expect(parseHoldValue('31.5', 'temperature_c')).toEqual({ ok: true, value: 31.5 });
    expect(parseHoldValue(' 0 ', 'power_kw')).toEqual({ ok: true, value: 0 });
    expect(parseHoldValue('-12', 'temperature_c')).toEqual({ ok: true, value: -12 });
  });

  it('reads a comma as a decimal point', () => {
    expect(parseHoldValue('31,5', 'temperature_c')).toEqual({ ok: true, value: 31.5 });
  });

  it('accepts the ends of the range', () => {
    expect(parseHoldValue('-40', 'temperature_c').ok).toBe(true);
    expect(parseHoldValue('85', 'temperature_c').ok).toBe(true);
  });

  it('refuses a value outside the range and says what the range is', () => {
    expect(parseHoldValue('85.1', 'temperature_c')).toEqual({
      ok: false,
      message: 'temperature_c accepts -40 to 85 °C',
    });
    expect(parseHoldValue('101', 'humidity_pct').ok).toBe(false);
    expect(parseHoldValue('-1', 'co2_ppm').ok).toBe(false);
  });

  it('refuses nothing, text, and what is not finite', () => {
    expect(parseHoldValue('', 'temperature_c')).toEqual({ ok: false, message: 'Enter a value' });
    expect(parseHoldValue('   ', 'temperature_c').ok).toBe(false);
    expect(parseHoldValue('hot', 'temperature_c')).toEqual({
      ok: false,
      message: '“hot” is not a number',
    });
    expect(parseHoldValue('Infinity', 'temperature_c').ok).toBe(false);
    expect(parseHoldValue('NaN', 'temperature_c').ok).toBe(false);
  });

  it('has no range to check for a metric the contract lacks', () => {
    expect(parseHoldValue('1e6', 'pressure_hpa')).toEqual({ ok: true, value: 1_000_000 });
  });
});

describe('parseIntervalMs', () => {
  it('reads whole milliseconds from 1 to an hour', () => {
    expect(parseIntervalMs('2000')).toEqual({ ok: true, value: 2000 });
    expect(parseIntervalMs('1')).toEqual({ ok: true, value: 1 });
    expect(parseIntervalMs(String(MAX_INTERVAL_MS))).toEqual({ ok: true, value: MAX_INTERVAL_MS });
  });

  it('refuses nothing, fractions, zero, negatives and more than an hour', () => {
    expect(parseIntervalMs('')).toEqual({ ok: false, message: 'Enter milliseconds' });
    expect(parseIntervalMs('1.5').ok).toBe(false);
    expect(parseIntervalMs('0').ok).toBe(false);
    expect(parseIntervalMs('-5').ok).toBe(false);
    expect(parseIntervalMs(String(MAX_INTERVAL_MS + 1))).toEqual({
      ok: false,
      message: 'Use 1 to 3,600,000 ms',
    });
    expect(parseIntervalMs('abc').ok).toBe(false);
  });
});

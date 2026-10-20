import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from '../api/types';
import { holdMetrics, holdTargets, nameList } from './holdTargets';

const device = (id: string, metrics: DeviceInfo['metrics']): DeviceInfo => ({
  id,
  kind: 'x',
  zoneCode: 'Z',
  metrics,
});
const devices = [
  device('a', ['temperature_c', 'humidity_pct']),
  device('b', ['temperature_c']),
  device('c', ['co2_ppm', 'temperature_c']),
  device('d', ['power_kw']),
];

describe('holdMetrics', () => {
  it('lists every metric any device reports, the most common first', () => {
    expect(holdMetrics(devices)).toEqual(['temperature_c', 'humidity_pct', 'co2_ppm', 'power_kw']);
  });

  it('keeps the order first met among equals', () => {
    expect(holdMetrics([device('x', ['power_kw', 'co2_ppm'])])).toEqual(['power_kw', 'co2_ppm']);
  });

  it('is empty for no devices', () => {
    expect(holdMetrics([])).toEqual([]);
  });
});

describe('holdTargets', () => {
  it('splits the devices into those that report the metric and those that do not', () => {
    expect(holdTargets(devices, 'temperature_c')).toEqual({
      targets: ['a', 'b', 'c'],
      skipped: ['d'],
    });
    expect(holdTargets(devices, 'power_kw')).toEqual({ targets: ['d'], skipped: ['a', 'b', 'c'] });
  });

  it('skips every device for a metric none reports', () => {
    expect(holdTargets(devices, 'pressure_hpa')).toEqual({
      targets: [],
      skipped: ['a', 'b', 'c', 'd'],
    });
  });
});

describe('nameList', () => {
  it('names the devices, and cuts a long list', () => {
    expect(nameList(['a', 'b'])).toBe('a, b');
    expect(nameList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c, d, e');
    expect(nameList(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('a, b, c, d, e and 2 more');
    expect(nameList([])).toBe('');
  });
});

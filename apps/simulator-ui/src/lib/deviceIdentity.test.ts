import { describe, expect, it } from 'vitest';
import fixture from '../api/fixtures/state-view.json';
import type { DeviceInfo, StateView } from '../api/types';
import { deviceCode, kindIdentity, metricIcon, metricUnit } from './deviceIdentity';

const devices = (fixture as StateView).devices;

describe('kindIdentity', () => {
  it('gives each kind of the registry its own shape and glyph', () => {
    expect(kindIdentity('server_room')).toEqual({
      shape: 'rounded-square',
      glyph: 'rack',
      label: 'Server room',
    });
    expect(kindIdentity('indoor_air')).toEqual({
      shape: 'circle',
      glyph: 'airflow',
      label: 'Indoor air',
    });
    expect(kindIdentity('power_meter')).toEqual({
      shape: 'hexagon',
      glyph: 'bolt',
      label: 'Power meter',
    });
  });

  it('gives three kinds three different shapes', () => {
    const shapes = ['server_room', 'indoor_air', 'power_meter'].map((k) => kindIdentity(k).shape);
    expect(new Set(shapes).size).toBe(3);
  });

  it('gives a kind it does not know a neutral shape and a readable label, never an error', () => {
    expect(kindIdentity('water_meter')).toEqual({
      shape: 'rounded',
      glyph: 'chip',
      label: 'Water meter',
    });
    expect(kindIdentity('')).toMatchObject({ shape: 'rounded', label: 'Device' });
  });

  it('does not take names off the prototype for kinds', () => {
    expect(kindIdentity('constructor').shape).toBe('rounded');
    expect(kindIdentity('__proto__').shape).toBe('rounded');
  });
});

describe('metricIcon and metricUnit', () => {
  it('has an icon for each metric of the contract, and a generic one for any other', () => {
    expect(metricIcon('temperature_c')).toBe('temperature');
    expect(metricIcon('humidity_pct')).toBe('humidity');
    expect(metricIcon('co2_ppm')).toBe('co2');
    expect(metricIcon('power_kw')).toBe('power');
    expect(metricIcon('pressure_hpa')).toBe('gauge');
    expect(metricIcon('toString')).toBe('gauge');
  });

  it('reads the unit from the contract', () => {
    expect(metricUnit('temperature_c')).toBe('°C');
    expect(metricUnit('co2_ppm')).toBe('ppm');
    expect(metricUnit('pressure_hpa')).toBe('');
  });
});

describe('deviceCode', () => {
  it('codes the six devices of the registry', () => {
    expect(devices.map((d) => deviceCode(d, devices))).toEqual([
      'DC·1',
      'DC·2',
      'LIB',
      'LHA',
      'STU',
      'HUB',
    ]);
  });

  it('numbers by position in the registry among the devices of the zone', () => {
    const zone = (id: string): DeviceInfo => ({
      id,
      kind: 'indoor_air',
      zoneCode: 'BLD-LIB',
      metrics: ['co2_ppm'],
    });
    const list = [zone('a'), { ...zone('x'), zoneCode: 'BLD-DC' }, zone('b'), zone('c')];
    expect(list.map((d) => deviceCode(d, list))).toEqual(['LIB·1', 'DC', 'LIB·2', 'LIB·3']);
  });

  it('keeps a zone code that has no BLD- prefix, and falls back to the id with no zone', () => {
    const odd: DeviceInfo = { id: 'pump-7', kind: 'x', zoneCode: 'NORTH', metrics: [] };
    expect(deviceCode(odd, [odd])).toBe('NORTH');
    const none: DeviceInfo = { id: 'pump-7', kind: 'x', zoneCode: '', metrics: [] };
    expect(deviceCode(none, [none])).toBe('PUM');
  });
});

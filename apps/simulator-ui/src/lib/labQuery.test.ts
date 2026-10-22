import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from '../api/types';
import { DEFAULT_LAB_QUERY, readLabQuery, sanitizeLabQuery, writeLabQuery } from './labQuery';

const params = (text: string) => new URLSearchParams(text);

describe('readLabQuery', () => {
  it('reads the defaults from an empty address', () => {
    expect(readLabQuery(params(''))).toEqual(DEFAULT_LAB_QUERY);
  });

  it('reads every parameter, and repeated targets in the order given', () => {
    expect(
      readLabQuery(
        params(
          'scope=zone&target=BLD-LIB&target=BLD-DC&zone=BLD-LIB&tab=targets&page=3&log=alerts&logPage=2',
        ),
      ),
    ).toEqual({
      scope: 'zone',
      targets: ['BLD-LIB', 'BLD-DC'],
      zone: 'BLD-LIB',
      tab: 'targets',
      page: 3,
      log: 'alerts',
      logPage: 2,
    });
  });

  it('falls back to the default for a value that is not allowed', () => {
    expect(
      readLabQuery(params('scope=planet&tab=most&page=0&log=everything&logPage=abc&zone=')),
    ).toEqual(DEFAULT_LAB_QUERY);
    expect(readLabQuery(params('page=2.5')).page).toBe(1);
    expect(readLabQuery(params('page=-4')).page).toBe(1);
  });

  it('drops repeated and empty targets, and cuts a long name', () => {
    const q = readLabQuery(params(`target=a&target=a&target=&target=${'x'.repeat(100)}`));
    expect(q.targets).toHaveLength(2);
    expect(q.targets[1]).toHaveLength(64);
  });

  it('keeps at most 200 targets', () => {
    const many = Array.from({ length: 300 }, (_, i) => `target=d${i}`).join('&');
    expect(readLabQuery(params(many)).targets).toHaveLength(200);
  });
});

describe('writeLabQuery', () => {
  it('writes nothing for the defaults', () => {
    expect(writeLabQuery(params(''), DEFAULT_LAB_QUERY).toString()).toBe('');
  });

  it('writes what differs, targets one by one, and reads back what it wrote', () => {
    const query = {
      scope: 'device' as const,
      targets: ['dc-env-01', 'dc-env-02'],
      zone: 'BLD-DC',
      tab: 'problems' as const,
      page: 2,
      log: 'faults' as const,
      logPage: 4,
    };
    const written = writeLabQuery(params(''), query);
    expect(written.toString()).toBe(
      'target=dc-env-01&target=dc-env-02&zone=BLD-DC&tab=problems&page=2&log=faults&logPage=4',
    );
    expect(readLabQuery(written)).toEqual(query);
  });

  it('leaves the parameters that are not its own, and replaces its own', () => {
    const next = writeLabQuery(params('keep=1&target=old&scope=class&page=9'), {
      ...DEFAULT_LAB_QUERY,
      targets: ['new'],
    });
    expect(next.get('keep')).toBe('1');
    expect(next.getAll('target')).toEqual(['new']);
    expect(next.has('scope')).toBe(false);
    expect(next.has('page')).toBe(false);
  });

  it('does not change the params it was given', () => {
    const given = params('target=a');
    writeLabQuery(given, { ...DEFAULT_LAB_QUERY, targets: ['b'] });
    expect(given.toString()).toBe('target=a');
  });
});

describe('sanitizeLabQuery', () => {
  const devices: DeviceInfo[] = [
    { id: 'dc-env-01', kind: 'server_room', zoneCode: 'BLD-DC', metrics: ['temperature_c'] },
    { id: 'lib-air-01', kind: 'indoor_air', zoneCode: 'BLD-LIB', metrics: ['co2_ppm'] },
  ];

  it('drops targets the registry does not have, by scope, and a zone that is not there', () => {
    const device = sanitizeLabQuery(
      { ...DEFAULT_LAB_QUERY, targets: ['ghost', 'lib-air-01'], zone: 'BLD-NOPE' },
      devices,
    );
    expect(device.targets).toEqual(['lib-air-01']);
    expect(device.zone).toBeNull();
    const zone = sanitizeLabQuery(
      { ...DEFAULT_LAB_QUERY, scope: 'zone', targets: ['BLD-DC', 'BLD-X'], zone: 'BLD-DC' },
      devices,
    );
    expect(zone).toMatchObject({ targets: ['BLD-DC'], zone: 'BLD-DC' });
  });
});

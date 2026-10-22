import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from '../api/types';
import { type DeviceStatusKind, STATUS_WORDS } from './deviceStatus';
import type { FleetRow } from './fleetQuery';
import {
  appliesSentence,
  matchesTab,
  PICKER_ZONE_LIMIT,
  pickerGroups,
  pruneTargets,
  reachByMetric,
  resolveTargets,
  scopeOptions,
  selectZone,
  tabCounts,
  targetChips,
  targetCounts,
  toggleTarget,
  zoneSelection,
} from './labTargets';

const device = (
  id: string,
  zoneCode: string,
  kind = 'server_room',
  metrics: DeviceInfo['metrics'] = ['temperature_c', 'humidity_pct'],
): DeviceInfo => ({ id, kind, zoneCode, metrics });

const devices: DeviceInfo[] = [
  device('dc-env-01', 'BLD-DC'),
  device('dc-env-02', 'BLD-DC'),
  device('lib-air-01', 'BLD-LIB', 'indoor_air', ['co2_ppm', 'temperature_c']),
  device('lib-air-02', 'BLD-LIB', 'indoor_air', ['co2_ppm', 'temperature_c']),
  device('lib-air-03', 'BLD-LIB', 'indoor_air', ['co2_ppm', 'temperature_c']),
  device('hub-power-01', 'BLD-HUB', 'power_meter', ['power_kw']),
];

const rowOf = (d: DeviceInfo, kind: DeviceStatusKind = 'running'): FleetRow => ({
  device: d,
  name: d.id,
  code: d.id.slice(0, 3),
  status: {
    kind,
    node: kind === 'running' ? 'healthy' : 'paused',
    word: STATUS_WORDS[kind],
    since: null,
    reason: null,
  },
  readings: [],
  lastSeen: null,
});

const rows: FleetRow[] = [
  rowOf(devices[0]!, 'anomaly'),
  rowOf(devices[1]!, 'running'),
  rowOf(devices[2]!, 'running'),
  rowOf(devices[3]!, 'paused'),
  rowOf(devices[4]!, 'stopped'),
  rowOf(devices[5]!, 'silent'),
];

describe('resolveTargets and pruneTargets', () => {
  it('reaches the named devices, in the order of the registry, each once', () => {
    expect(
      resolveTargets(devices, 'device', ['lib-air-02', 'dc-env-01', 'dc-env-01']).map((d) => d.id),
    ).toEqual(['dc-env-01', 'lib-air-02']);
  });

  it('reaches every device of a zone or of a class, playing or not', () => {
    expect(resolveTargets(devices, 'zone', ['BLD-LIB']).map((d) => d.id)).toEqual([
      'lib-air-01',
      'lib-air-02',
      'lib-air-03',
    ]);
    expect(
      resolveTargets(devices, 'class', ['power_meter', 'server_room']).map((d) => d.id),
    ).toEqual(['dc-env-01', 'dc-env-02', 'hub-power-01']);
  });

  it('reaches nothing for no choice', () => {
    expect(resolveTargets(devices, 'device', [])).toEqual([]);
  });

  it('drops what the registry does not have and what is repeated, and keeps the order chosen', () => {
    expect(
      pruneTargets(devices, 'device', ['ghost', 'hub-power-01', 'dc-env-01', 'hub-power-01']),
    ).toEqual(['hub-power-01', 'dc-env-01']);
    expect(pruneTargets(devices, 'zone', ['BLD-LIB', 'BLD-NOPE'])).toEqual(['BLD-LIB']);
    expect(pruneTargets(devices, 'class', ['indoor_air', 'tractor'])).toEqual(['indoor_air']);
  });
});

describe('choosing', () => {
  it('adds a target at the end and takes one out', () => {
    expect(toggleTarget(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleTarget(['a', 'b'], 'a', true)).toEqual(['b', 'a']);
    expect(toggleTarget(['a', 'b'], 'a', false)).toEqual(['b']);
  });

  it('says none, some or all for the box of a zone', () => {
    const zone = ['x', 'y', 'z'];
    expect(zoneSelection(zone, new Set())).toBe('none');
    expect(zoneSelection(zone, new Set(['y']))).toBe('some');
    expect(zoneSelection(zone, new Set(['x', 'y', 'z', 'other']))).toBe('all');
  });

  it('chooses and clears a whole zone without touching the rest', () => {
    expect(selectZone(['other'], ['x', 'y'], true)).toEqual(['other', 'x', 'y']);
    expect(selectZone(['other', 'x'], ['x', 'y'], true)).toEqual(['other', 'x', 'y']);
    expect(selectZone(['other', 'x', 'y'], ['x', 'y'], false)).toEqual(['other']);
  });
});

describe('chips and the sentence under the field', () => {
  it('has a chip for a device, and one with its count for a zone or a class', () => {
    expect(targetChips(devices, 'device', ['dc-env-01'])).toEqual([
      { id: 'dc-env-01', label: 'dc-env-01', count: null },
    ]);
    expect(targetChips(devices, 'zone', ['BLD-LIB', 'BLD-DC'])).toEqual([
      { id: 'BLD-LIB', label: 'BLD-LIB', count: 3 },
      { id: 'BLD-DC', label: 'BLD-DC', count: 2 },
    ]);
    expect(targetChips(devices, 'class', ['indoor_air'])).toEqual([
      { id: 'indoor_air', label: 'Indoor air', count: 3 },
    ]);
  });

  it('counts the devices reached, of the registry, and the zones they are in', () => {
    const reached = resolveTargets(devices, 'zone', ['BLD-LIB', 'BLD-DC']);
    expect(targetCounts(devices, reached)).toEqual({ devices: 5, of: 6, zones: 2 });
  });

  it('writes the sentence of frames 12 and 19', () => {
    expect(appliesSentence({ devices: 12, of: 100, zones: 3 })).toBe(
      'Applies to 12 of 100 devices in 3 zones',
    );
    expect(appliesSentence({ devices: 1, of: 2, zones: 1 }, 'BLD-DC')).toBe(
      'Applies to 1 of 2 devices in BLD-DC',
    );
    expect(appliesSentence({ devices: 0, of: 6, zones: 0 })).toBe('Applies to 0 of 6 devices');
    expect(appliesSentence({ devices: 1, of: 1, zones: 1 })).toBe(
      'Applies to 1 of 1 device in one zone',
    );
  });

  it('says which of the devices chosen a metric does not reach', () => {
    const reached = resolveTargets(devices, 'zone', ['BLD-LIB', 'BLD-HUB']);
    expect(reachByMetric(reached, 'co2_ppm')).toEqual({
      targets: ['lib-air-01', 'lib-air-02', 'lib-air-03'],
      skipped: ['hub-power-01'],
    });
  });
});

describe('the tabs', () => {
  it('counts All, Playing (running, anomaly, silent) and Problems (anything but running)', () => {
    expect(tabCounts(rows, '')).toEqual({ all: 6, playing: 4, problems: 4 });
  });

  it('follows the search', () => {
    expect(tabCounts(rows, 'lib-air')).toEqual({ all: 3, playing: 1, problems: 2 });
    expect(tabCounts(rows, 'nothing like it')).toEqual({ all: 0, playing: 0, problems: 0 });
  });

  it('tells whether a row is on a tab', () => {
    expect(matchesTab(rows[3]!, 'playing')).toBe(false);
    expect(matchesTab(rows[3]!, 'problems')).toBe(true);
    expect(matchesTab(rows[1]!, 'problems')).toBe(false);
    expect(matchesTab(rows[1]!, 'all')).toBe(true);
  });
});

describe('pickerGroups', () => {
  const open = new Set<string>();

  it('groups the rows under their zone in the order the zones appear', () => {
    const groups = pickerGroups(rows, { tab: 'all', q: '', open });
    expect(groups.map((g) => [g.zone, g.rows.length])).toEqual([
      ['BLD-DC', 2],
      ['BLD-LIB', 3],
      ['BLD-HUB', 1],
    ]);
  });

  it('keeps the rows of the tab and the search, and leaves out a zone with none', () => {
    expect(pickerGroups(rows, { tab: 'playing', q: '', open }).map((g) => g.zone)).toEqual([
      'BLD-DC',
      'BLD-LIB',
      'BLD-HUB',
    ]);
    expect(pickerGroups(rows, { tab: 'all', q: 'hub', open }).map((g) => g.zone)).toEqual([
      'BLD-HUB',
    ]);
    expect(
      pickerGroups(rows, { tab: 'problems', q: 'dc', open })[0]?.rows.map((r) => r.device.id),
    ).toEqual(['dc-env-01']);
  });

  it('shows a few rows of a big zone and says how many more, until it is opened', () => {
    const big = Array.from({ length: 10 }, (_, i) => rowOf(device(`big-${i}`, 'BLD-BIG')));
    const closed = pickerGroups(big, { tab: 'all', q: '', open })[0]!;
    expect(closed.shown).toHaveLength(PICKER_ZONE_LIMIT);
    expect(closed.more).toBe(10 - PICKER_ZONE_LIMIT);
    const opened = pickerGroups(big, { tab: 'all', q: '', open: new Set(['BLD-BIG']) })[0]!;
    expect(opened.shown).toHaveLength(10);
    expect(opened.more).toBe(0);
  });
});

describe('scopeOptions', () => {
  it('offers every zone with its count, and every class written for a person', () => {
    expect(scopeOptions(devices, 'zone', '')).toEqual([
      { id: 'BLD-DC', label: 'BLD-DC', count: 2 },
      { id: 'BLD-LIB', label: 'BLD-LIB', count: 3 },
      { id: 'BLD-HUB', label: 'BLD-HUB', count: 1 },
    ]);
    expect(scopeOptions(devices, 'class', '').map((o) => o.label)).toEqual([
      'Server room',
      'Indoor air',
      'Power meter',
    ]);
  });

  it('is searched by the id and by the label', () => {
    expect(scopeOptions(devices, 'zone', 'lib').map((o) => o.id)).toEqual(['BLD-LIB']);
    expect(scopeOptions(devices, 'class', 'power meter').map((o) => o.id)).toEqual(['power_meter']);
    expect(scopeOptions(devices, 'zone', 'xyz')).toEqual([]);
  });
});

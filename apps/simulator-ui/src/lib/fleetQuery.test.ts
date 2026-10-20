import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import { type DeviceStatusKind, STATUS_WORDS } from './deviceStatus';
import {
  applyFleetQuery,
  cardsAllowed,
  DEFAULT_QUERY,
  effectiveView,
  facets,
  type FleetQuery,
  type FleetRow,
  groupByZone,
  matchesSearch,
  pageSelection,
  paginate,
  parseFleetQuery,
  pruneSelection,
  serializeFleetQuery,
  setPageSelected,
  toggleSelected,
} from './fleetQuery';

const NOW = Date.parse('2026-10-20T09:15:00.000Z');

const row = (
  id: string,
  kind: DeviceStatusKind,
  options: { zone?: string; deviceKind?: string; name?: string; seenAgoS?: number | null } = {},
): FleetRow => {
  const { zone = 'BLD-DC', deviceKind = 'server_room', name = id, seenAgoS = 1 } = options;
  return {
    device: { id, kind: deviceKind, zoneCode: zone, metrics: ['temperature_c'], name },
    name,
    code: id.slice(0, 3).toUpperCase(),
    status: {
      kind,
      node: kind === 'running' ? 'healthy' : 'paused',
      word: STATUS_WORDS[kind],
      since: null,
      reason: null,
    },
    readings: [{ metric: 'temperature_c', value: 22 }],
    lastSeen: seenAgoS === null ? null : NOW - seenAgoS * 1000,
  };
};

const query = (change: Partial<FleetQuery> = {}): FleetQuery => ({ ...DEFAULT_QUERY, ...change });
const ids = (rows: readonly FleetRow[]) => rows.map((r) => r.device.id);

const devices: FleetRow[] = [
  row('dc-env-01', 'anomaly', { name: 'Data center — row A' }),
  row('dc-env-02', 'running', { name: 'Data center — row B' }),
  row('lib-air-01', 'running', {
    zone: 'BLD-LIB',
    deviceKind: 'indoor_air',
    name: 'Library reading room',
  }),
  row('lha-air-01', 'running', {
    zone: 'BLD-LHA',
    deviceKind: 'indoor_air',
    name: 'Lecture Hall A',
  }),
  row('stu-air-01', 'paused', {
    zone: 'BLD-STU',
    deviceKind: 'indoor_air',
    name: 'Student Center hall',
    seenAgoS: 40,
  }),
  row('hub-power-01', 'stopped', {
    zone: 'BLD-HUB',
    deviceKind: 'power_meter',
    name: 'Innovation Hub main feed',
    seenAgoS: 200,
  }),
];

describe('parseFleetQuery and serializeFleetQuery', () => {
  it('reads an empty address as the default', () => {
    expect(parseFleetQuery(new URLSearchParams())).toEqual(DEFAULT_QUERY);
  });

  it('writes the default as an empty address', () => {
    expect(serializeFleetQuery(DEFAULT_QUERY).toString()).toBe('');
  });

  it('round-trips a query with everything set', () => {
    const full = query({
      q: 'air hall',
      zone: 'BLD-LHA',
      kind: 'indoor_air',
      tab: 'running',
      sort: 'zone',
      dir: 'desc',
      group: true,
      view: 'table',
      page: 3,
      size: 50,
      device: 'lha-air-01',
    });
    expect(parseFleetQuery(serializeFleetQuery(full))).toEqual(full);
  });

  it('writes only what differs from the default', () => {
    expect(serializeFleetQuery(query({ tab: 'anomaly', page: 2 })).toString()).toBe(
      'tab=anomaly&page=2',
    );
  });

  it('does not write a direction for "problems first", which has only one', () => {
    expect(serializeFleetQuery(query({ sort: 'problems', dir: 'desc' })).toString()).toBe('');
  });

  it('falls back to the default for values that are not allowed', () => {
    const parsed = parseFleetQuery(
      new URLSearchParams('tab=nope&sort=colour&dir=up&view=grid&page=-4&size=13&group=yes'),
    );
    expect(parsed).toEqual(DEFAULT_QUERY);
    expect(parseFleetQuery(new URLSearchParams('page=2.5')).page).toBe(1);
    expect(parseFleetQuery(new URLSearchParams('page=abc')).page).toBe(1);
  });

  it('keeps a long search from filling the address', () => {
    expect(parseFleetQuery(new URLSearchParams(`q=${'x'.repeat(500)}`)).q).toHaveLength(100);
  });

  it('accepts only the page sizes of the pager', () => {
    for (const size of [10, 25, 50, 100]) {
      expect(parseFleetQuery(new URLSearchParams(`size=${size}`)).size).toBe(size);
    }
    expect(parseFleetQuery(new URLSearchParams('size=7')).size).toBe(10);
  });
});

describe('effectiveView and cardsAllowed', () => {
  it('is cards up to 12 devices and a table above', () => {
    expect(effectiveView(query(), 6)).toBe('cards');
    expect(effectiveView(query(), 12)).toBe('cards');
    expect(effectiveView(query(), 13)).toBe('table');
  });

  it('gives a table when asked for, even with six devices', () => {
    expect(effectiveView(query({ view: 'table' }), 6)).toBe('table');
  });

  it('does not give cards above 12 devices however the address asks', () => {
    expect(effectiveView(query({ view: 'cards' }), 31)).toBe('table');
    expect(cardsAllowed(12)).toBe(true);
    expect(cardsAllowed(13)).toBe(false);
  });
});

describe('matchesSearch', () => {
  const dc = devices[0] as FleetRow;
  it('matches the id, the name, the zone and the kind, whatever the case', () => {
    expect(matchesSearch(dc, 'dc-env')).toBe(true);
    expect(matchesSearch(dc, 'ROW A')).toBe(true);
    expect(matchesSearch(dc, 'bld-dc')).toBe(true);
    expect(matchesSearch(dc, 'server room')).toBe(true);
    expect(matchesSearch(dc, 'server_room')).toBe(true);
  });

  it('needs every word to match', () => {
    expect(matchesSearch(dc, 'dc row')).toBe(true);
    expect(matchesSearch(dc, 'dc library')).toBe(false);
  });

  it('matches everything for an empty or blank search', () => {
    expect(matchesSearch(dc, '')).toBe(true);
    expect(matchesSearch(dc, '   ')).toBe(true);
  });
});

describe('applyFleetQuery', () => {
  it('lists problems first by default: anomaly, silent, paused, stopped, then running, by id inside a state', () => {
    expect(ids(applyFleetQuery(devices, query()).rows)).toEqual([
      'dc-env-01',
      'stu-air-01',
      'hub-power-01',
      'dc-env-02',
      'lha-air-01',
      'lib-air-01',
    ]);
  });

  it('counts the tabs over the search, zone and kind filters, and not over the tab itself', () => {
    const all = applyFleetQuery(devices, query()).counts;
    expect(all).toEqual({ all: 6, running: 3, anomaly: 1, paused: 1, stopped: 1, silent: 0 });
    const air = applyFleetQuery(devices, query({ kind: 'indoor_air', tab: 'paused' }));
    expect(air.counts).toEqual({
      all: 3,
      running: 2,
      anomaly: 0,
      paused: 1,
      stopped: 0,
      silent: 0,
    });
    expect(ids(air.rows)).toEqual(['stu-air-01']);
  });

  it('filters by search, zone and kind together', () => {
    expect(ids(applyFleetQuery(devices, query({ q: 'hall' })).rows)).toEqual([
      'stu-air-01',
      'lha-air-01',
    ]);
    expect(ids(applyFleetQuery(devices, query({ zone: 'BLD-LIB' })).rows)).toEqual(['lib-air-01']);
    expect(ids(applyFleetQuery(devices, query({ q: 'air', zone: 'BLD-LIB' })).rows)).toEqual([
      'lib-air-01',
    ]);
    expect(applyFleetQuery(devices, query({ q: 'zzz' })).rows).toEqual([]);
  });

  it('sorts by a column, ascending and descending, ending on the id', () => {
    expect(ids(applyFleetQuery(devices, query({ sort: 'device' })).rows)).toEqual([
      'dc-env-01',
      'dc-env-02',
      'hub-power-01',
      'lha-air-01',
      'lib-air-01',
      'stu-air-01',
    ]);
    expect(ids(applyFleetQuery(devices, query({ sort: 'device', dir: 'desc' })).rows)[0]).toBe(
      'stu-air-01',
    );
    // Two devices in the same zone keep the id order, whichever way the zone sorts.
    const byZone = applyFleetQuery(devices, query({ sort: 'zone', dir: 'desc' })).rows;
    expect(ids(byZone).slice(-2)).toEqual(['dc-env-01', 'dc-env-02']);
  });

  it('sorts by name and by class', () => {
    expect(ids(applyFleetQuery(devices, query({ sort: 'name' })).rows)[0]).toBe('dc-env-01');
    expect(ids(applyFleetQuery(devices, query({ sort: 'class' })).rows)[0]).toBe('lha-air-01');
  });

  it('sorts by last seen: the longest quiet first, a device never heard from before all', () => {
    const withNever = [...devices, row('new-01', 'running', { seenAgoS: null })];
    expect(ids(applyFleetQuery(withNever, query({ sort: 'seen' })).rows).slice(0, 3)).toEqual([
      'new-01',
      'hub-power-01',
      'stu-air-01',
    ]);
  });

  it('ignores the direction for "problems first"', () => {
    expect(ids(applyFleetQuery(devices, query({ dir: 'desc' })).rows)).toEqual(
      ids(applyFleetQuery(devices, query()).rows),
    );
  });

  it('does not change the list it was given', () => {
    const before = ids(devices);
    applyFleetQuery(devices, query({ sort: 'zone', dir: 'desc' }));
    expect(ids(devices)).toEqual(before);
  });
});

describe('facets', () => {
  it('lists the zones and kinds once each, sorted', () => {
    expect(facets(fixture.devices)).toEqual({
      zones: ['BLD-DC', 'BLD-HUB', 'BLD-LHA', 'BLD-LIB', 'BLD-STU'],
      kinds: ['indoor_air', 'power_meter', 'server_room'],
    });
  });
});

describe('paginate', () => {
  const list = Array.from({ length: 31 }, (_, i) => i + 1);

  it('takes a page and says which rows it holds', () => {
    const page = paginate(list, 2, 10);
    expect(page.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page).toMatchObject({ page: 2, pageCount: 4, total: 31, from: 11, to: 20, size: 10 });
  });

  it('has a short last page', () => {
    expect(paginate(list, 4, 10)).toMatchObject({ from: 31, to: 31, items: [31] });
  });

  it('takes the last page for a page past the end, and the first for nonsense', () => {
    expect(paginate(list, 99, 10).page).toBe(4);
    expect(paginate(list, 0, 10).page).toBe(1);
    expect(paginate(list, Number.NaN, 10).page).toBe(1);
  });

  it('is one empty page for an empty list', () => {
    expect(paginate([], 1, 10)).toMatchObject({
      items: [],
      page: 1,
      pageCount: 1,
      total: 0,
      from: 0,
      to: 0,
    });
  });
});

describe('groupByZone', () => {
  it('groups rows under their zone, in the order the zones first appear, keeping the order inside', () => {
    const groups = groupByZone(applyFleetQuery(devices, query()).rows);
    expect(groups.map((g) => g.zone)).toEqual([
      'BLD-DC',
      'BLD-STU',
      'BLD-HUB',
      'BLD-LHA',
      'BLD-LIB',
    ]);
    expect(ids(groups[0]?.rows ?? [])).toEqual(['dc-env-01', 'dc-env-02']);
  });

  it('is empty for no rows', () => {
    expect(groupByZone([])).toEqual([]);
  });
});

describe('selection', () => {
  const page = ['a', 'b', 'c'];

  it('says none, some or all for a page', () => {
    expect(pageSelection(new Set(), page)).toBe('none');
    expect(pageSelection(new Set(['b', 'x']), page)).toBe('some');
    expect(pageSelection(new Set(page), page)).toBe('all');
    expect(pageSelection(new Set(['a']), [])).toBe('none');
  });

  it('toggles one id without changing the set it was given', () => {
    const start = new Set(['a']);
    const added = toggleSelected(start, 'b');
    expect([...added]).toEqual(['a', 'b']);
    expect([...toggleSelected(added, 'a')]).toEqual(['b']);
    expect([...start]).toEqual(['a']);
  });

  it('selects or unselects a whole page and leaves the rest', () => {
    const start = new Set(['z']);
    expect([...setPageSelected(start, page, true)].sort()).toEqual(['a', 'b', 'c', 'z']);
    expect([...setPageSelected(new Set(['a', 'b', 'z']), page, false)]).toEqual(['z']);
  });

  it('drops what is no longer in the list', () => {
    expect([...pruneSelection(new Set(['a', 'gone']), ['a', 'b'])]).toEqual(['a']);
  });
});

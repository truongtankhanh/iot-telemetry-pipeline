import { describe, expect, it } from 'vitest';
import fixture from '../api/fixtures/state-view.json';
import type { StateView } from '../api/types';
import { GROUP_LIMIT, matchPalette, normalize, parseQuery, score, visibleItems } from './palette';
import { buildPaletteItems, type PaletteGroup, type PaletteItem } from './paletteItems';
import { appRoutes } from './routes';

const items = buildPaletteItems({
  view: fixture as StateView,
  routes: appRoutes({ foundations: true }),
});
const labels = (matches: ReturnType<typeof matchPalette>, group: PaletteGroup) =>
  matches.groups.find((g) => g.group === group)?.items.map((i) => i.label);

const alert = (id: string, severity: string, open: boolean): PaletteItem => ({
  group: 'alerts',
  id: `alerts:${id}`,
  label: `#${id} Disk full`,
  detail: null,
  keywords: [],
  target: null,
  severity,
  open,
  disabled: null,
});

describe('parseQuery and normalize', () => {
  it('reads the four prefixes', () => {
    expect(parseQuery('d:lib')).toEqual({ group: 'devices', text: 'lib' });
    expect(parseQuery('a: server')).toEqual({ group: 'alerts', text: 'server' });
    expect(parseQuery('s:crowd')).toEqual({ group: 'scenarios', text: 'crowd' });
    expect(parseQuery('>reset')).toEqual({ group: 'actions', text: 'reset' });
    expect(parseQuery('> run')).toEqual({ group: 'actions', text: 'run' });
    expect(parseQuery('  dc')).toEqual({ group: null, text: 'dc' });
  });

  it('takes the accents and the case off', () => {
    expect(normalize('Café Đà Lạt')).toBe('cafe đa lat');
  });
});

describe('score', () => {
  const device = items.find((i) => i.id === 'devices:dc-env-01')!;
  it('ranks a whole label above its start, above a word of it, above a substring', () => {
    expect(score(device, 'dc-env-01')).toBe(100);
    expect(score(device, 'dc-e')).toBe(80);
    expect(score(device, 'env')).toBe(70);
    expect(score(device, 'nv-0')).toBe(40);
    expect(score(device, 'zzz')).toBe(0);
  });

  it('matches a keyword and the detail with less weight than the label', () => {
    expect(score(device, 'bld-dc')).toBe(90); // a keyword, whole
    expect(score(device, 'row a')).toBe(30); // only in the detail
  });
});

describe('what dc finds (frame 17)', () => {
  const matches = matchPalette(items, 'dc');
  it('finds the devices, the zone, the alert of the device and the topics, in the order of the groups', () => {
    expect(matches.groups.map((g) => g.group)).toEqual(['devices', 'zones', 'alerts', 'topics']);
    expect(labels(matches, 'devices')).toEqual(['dc-env-01', 'dc-env-02']);
    expect(labels(matches, 'zones')).toEqual(['BLD-DC']);
    expect(labels(matches, 'alerts')).toEqual(['#7 Server room temperature high']);
    expect(matches.total).toBe(2 + 1 + 1 + 2);
  });

  it('finds nothing in the pages for it, and the result list is the keyboard order', () => {
    expect(matches.groups.some((g) => g.group === 'pages')).toBe(false);
    expect(visibleItems(matches).map((i) => i.group)).toEqual([
      'devices',
      'devices',
      'zones',
      'alerts',
      'topics',
      'topics',
    ]);
  });
});

describe('prefixes', () => {
  it('narrow the search to one group', () => {
    expect(matchPalette(items, 'd:lib').groups.map((g) => g.group)).toEqual(['devices']);
    expect(labels(matchPalette(items, 'd:lib'), 'devices')).toEqual(['lib-air-01']);
    expect(labels(matchPalette(items, 'a:server'), 'alerts')).toEqual([
      '#7 Server room temperature high',
    ]);
    expect(labels(matchPalette(items, 's:crowd'), 'scenarios')).toEqual(['crowded-lecture']);
    expect(labels(matchPalette(items, '>res'), 'actions')).toEqual(['reset']);
    expect(matchPalette(items, 'd:lib').prefix).toBe('devices');
  });

  it('offer the whole group when nothing follows them: five shown, the sixth behind "Show all"', () => {
    const matches = matchPalette(items, 'd:');
    expect(matches.total).toBe(6);
    expect(matches.groups[0]).toMatchObject({ group: 'devices', hidden: 1 });
    expect(labels(matches, 'devices')).toHaveLength(5);

    const all = matchPalette(items, 'd:', { expanded: new Set(['devices']) });
    expect(labels(all, 'devices')).toHaveLength(6);
    expect(all.groups[0]?.hidden).toBe(0);
  });
});

describe('what is shown when nothing is typed', () => {
  it('is the pages, in their order', () => {
    const matches = matchPalette(items, '');
    expect(matches.groups.map((g) => g.group)).toEqual(['pages']);
    expect(matches.groups[0]?.items[0]?.label).toBe('Overview');
  });
});

describe('ranking and the limit', () => {
  it('puts the exact label first', () => {
    const matches = matchPalette(items, 'lib-air-01');
    expect(labels(matches, 'devices')?.[0]).toBe('lib-air-01');
  });

  it('shows five of a group and counts the rest, until the group is expanded', () => {
    const many: PaletteItem[] = Array.from({ length: 8 }, (_, i) => ({
      ...alert(String(i), 'low', true),
      id: `x${i}`,
      label: `Disk ${i}`,
      group: 'devices' as const,
    }));
    const matches = matchPalette(many, 'disk');
    expect(GROUP_LIMIT).toBe(5);
    expect(matches.groups[0]).toMatchObject({ hidden: 3 });
    expect(matches.groups[0]?.items).toHaveLength(5);
    expect(matches.total).toBe(8);

    const expanded = matchPalette(many, 'disk', { expanded: new Set(['devices']) });
    expect(expanded.groups[0]).toMatchObject({ hidden: 0 });
    expect(expanded.groups[0]?.items).toHaveLength(8);
  });

  it('puts an open alert before a cleared one and a severe one before a mild one', () => {
    const list = [
      alert('1', 'low', false),
      alert('2', 'critical', false),
      alert('3', 'medium', true),
      alert('4', 'high', true),
    ];
    const matches = matchPalette(list, 'disk');
    expect(labels(matches, 'alerts')).toEqual([
      '#4 Disk full',
      '#3 Disk full',
      '#2 Disk full',
      '#1 Disk full',
    ]);
  });

  it('lets a better match beat an open alert', () => {
    const list = [alert('1', 'critical', true), { ...alert('2', 'low', false), label: 'Disk' }];
    expect(labels(matchPalette(list, 'disk'), 'alerts')?.[0]).toBe('Disk');
  });
});

describe('matching', () => {
  it('ignores case and accents', () => {
    const list: PaletteItem[] = [{ ...alert('1', 'low', true), group: 'devices', label: 'Café' }];
    expect(matchPalette(list, 'CAFE').total).toBe(1);
  });

  it('finds nothing for a query that matches nothing', () => {
    expect(matchPalette(items, 'qwxz')).toEqual({ prefix: null, groups: [], total: 0 });
  });

  it('is not thrown by characters that mean something in a pattern', () => {
    expect(() => matchPalette(items, '(.*[')).not.toThrow();
    expect(matchPalette(items, '(.*[').total).toBe(0);
  });
});

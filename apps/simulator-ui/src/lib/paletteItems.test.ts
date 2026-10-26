import { telemetryTopic } from '@itp/telemetry-contract';
import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { StateView } from '../api/types';
import { buildPaletteItems, type PaletteGroup } from './paletteItems';
import { appRoutes } from './routes';

const base = fixture;
const routes = appRoutes({ foundations: true });
const build = (change: (view: StateView) => void = () => {}) => {
  const view = structuredClone(base);
  change(view);
  return buildPaletteItems({ view, routes });
};
const group = (items: ReturnType<typeof build>, name: PaletteGroup) =>
  items.filter((i) => i.group === name);

describe('buildPaletteItems', () => {
  it('lists only the pages before the first message', () => {
    const items = buildPaletteItems({ view: null, routes });
    expect(new Set(items.map((i) => i.group))).toEqual(new Set(['pages']));
    expect(items).toHaveLength(routes.length);
  });

  it('lists every page, and says which are not built yet, with their ticket', () => {
    const pages = group(build(), 'pages');
    expect(pages.find((p) => p.target === '/')?.detail).toMatch(/Health of the simulated campus/);
    expect(pages.find((p) => p.target === '/fleet')?.detail).toMatch(
      /^Every device, its live values/,
    );
    expect(pages.find((p) => p.target === '/analytics')?.detail).toBe('Not built yet · SIM-15');
    expect(pages.find((p) => p.target === '/lab/faults')?.label).toBe('Lab · Faults');
  });

  it('lists the six devices with name, zone and state, and the anomaly over the state', () => {
    const devices = group(build(), 'devices');
    expect(devices.map((d) => d.label)).toEqual([
      'dc-env-01',
      'dc-env-02',
      'lib-air-01',
      'lha-air-01',
      'stu-air-01',
      'hub-power-01',
    ]);
    expect(devices[0]?.detail).toBe('Data center — row A · BLD-DC · anomaly');
    expect(devices[1]?.detail).toBe('Data center — row B · BLD-DC · running');
    expect(devices[5]?.detail).toBe('Innovation Hub main feed · BLD-HUB · paused');
    expect(devices[0]?.target).toBe('/fleet?device=dc-env-01');
  });

  it('derives the zones from the zone codes, once each, with a count', () => {
    const zones = group(build(), 'zones');
    expect(zones.map((z) => [z.label, z.detail])).toEqual([
      ['BLD-DC', '2 devices'],
      ['BLD-LIB', '1 device'],
      ['BLD-LHA', '1 device'],
      ['BLD-STU', '1 device'],
      ['BLD-HUB', '1 device'],
    ]);
  });

  it('lists the alerts with id, title, device and severity, and keeps their severity for ranking', () => {
    const [alert] = group(build(), 'alerts');
    expect(alert).toMatchObject({
      label: '#7 Server room temperature high',
      detail: 'dc-env-01 · high · open',
      severity: 'high',
      open: true,
      target: '/alerts?alert=7',
    });
  });

  it('lists the scenarios, and one topic per device built by the contract', () => {
    const items = build();
    expect(group(items, 'scenarios').map((s) => s.label)).toEqual([
      'server-room-overheat',
      'crowded-lecture',
    ]);
    const topics = group(items, 'topics');
    expect(topics).toHaveLength(6);
    expect(topics[0]?.label).toBe(telemetryTopic({ zoneCode: 'BLD-DC', deviceId: 'dc-env-01' }));
    expect(topics[0]?.target).toBe(`/events?topic=${encodeURIComponent(topics[0]?.label ?? '')}`);
  });

  it('lists the actions, each of which opens the Overview, and step only on the simulated clock', () => {
    const actions = group(build(), 'actions');
    expect(actions.map((a) => [a.label, a.target])).toEqual([
      ['run server-room-overheat', '/?scenario=server-room-overheat'],
      ['run crowded-lecture', '/?scenario=crowded-lecture'],
      ['pause', '/?focus=pause'],
      ['step', '/?focus=step'],
      ['reset', '/?focus=reset'],
    ]);
    // The palette runs nothing: an action can be chosen, and says where it goes.
    expect(actions.every((a) => a.disabled === null && a.detail === 'Opens the Overview')).toBe(
      true,
    );

    const wall = group(
      build((v) => void (v.config.simulated = false)),
      'actions',
    );
    expect(wall.map((a) => a.label)).not.toContain('step');
    expect(wall.map((a) => a.label)).toContain('reset');
  });

  it('encodes the name of a scenario in the address it opens', () => {
    const odd = build((v) => void (v.scenarios = ['a b&c']));
    expect(group(odd, 'actions')[0]?.target).toBe('/?scenario=a%20b%26c');
  });

  it('copes with a device without a name', () => {
    const items = build((v) => void delete v.devices[2]!.name);
    expect(group(items, 'devices')[2]?.detail).toBe('BLD-LIB · running');
  });
});

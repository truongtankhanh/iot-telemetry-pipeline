import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { DeviceSpec } from './signals.ts';
import {
  footprintOf,
  loadTwinLayout,
  MAX_LAYOUT_BYTES,
  parseTwinLayout,
  placementOf,
  type TwinDevice,
  twinLayoutUnavailable,
} from './twin-layout.ts';

type Rec = Record<string, unknown>;
type Registry = Pick<DeviceSpec, 'id' | 'zoneCode'>[];

// The smallest layout that is valid: a building with a device in it and an asset beside it, and a lawn.
const dataCenter = (change: Rec = {}) => ({
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  use: 'data_center',
  heightM: 14,
  at: [175, 40],
  size: [60, 46],
  ...change,
});
const lawn = (change: Rec = {}) => ({
  code: 'OUT-LAWN',
  name: 'Central Lawn',
  kind: 'outdoor',
  at: [20, 0],
  size: [110, 70],
  ...change,
});
const device = (change: Rec = {}) => ({
  id: 'dc-env-01',
  zone: 'BLD-DC',
  at: [170, 33],
  elevationM: 0,
  placement: 'illustrative',
  ...change,
});
const asset = (change: Rec = {}) => ({
  code: 'UPS-01',
  name: 'UPS room',
  class: 'ups',
  zone: 'BLD-DC',
  at: [164.5, 29.7],
  elevationM: 0,
  simulated: false,
  ...change,
});
const layoutDocument = (change: Rec = {}) => ({
  source: {
    repository: 'ops-command-center',
    commit: 'abc1234',
    files: ['apps/api/src/database/seed/campus.ts'],
    checkedOn: '2026-10-26',
  },
  siteCenter: [108.4415, 11.953],
  boundary: { west: -282, east: 228, south: -277, north: 247, radius: 18 },
  zones: [dataCenter(), lawn()],
  devices: [device()],
  catalogue: [asset()],
  ...change,
});

const refuses = (document: unknown, pattern: RegExp) =>
  assert.throws(() => parseTwinLayout(document), pattern);

describe('parseTwinLayout', () => {
  it('keeps the fields Studio reads and drops the ones it does not', () => {
    const parsed = parseTwinLayout({
      $comment: 'x',
      extra: 1,
      ...layoutDocument({ zones: [dataCenter({ owner: 'y' }), lawn()] }),
    });
    assert.deepEqual(parsed, layoutDocument());
  });

  it('refuses what is not a layout', () => {
    refuses(null, /must be a JSON object/);
    refuses([], /must be a JSON object/);
    refuses('x', /must be a JSON object/);
  });

  it('refuses a site centre that is not [longitude, latitude]', () => {
    refuses(layoutDocument({ siteCenter: [108] }), /siteCenter must be two finite numbers/);
    refuses(
      layoutDocument({ siteCenter: [200, 11] }),
      /siteCenter must be \[longitude, latitude\]/,
    );
    refuses(
      layoutDocument({ siteCenter: [108, 95] }),
      /siteCenter must be \[longitude, latitude\]/,
    );
  });

  it('refuses a source that does not say where the copy came from', () => {
    refuses(layoutDocument({ source: undefined }), /"source" must be an object/);
    refuses(
      layoutDocument({ source: { ...layoutDocument().source, commit: '' } }),
      /source\.commit is required/,
    );
    refuses(
      layoutDocument({ source: { ...layoutDocument().source, files: [] } }),
      /source\.files must be a non-empty list/,
    );
  });

  it('refuses a boundary that is not a rectangle', () => {
    const boundary = layoutDocument().boundary;
    refuses(layoutDocument({ boundary: undefined }), /"boundary" must be an object/);
    refuses(layoutDocument({ boundary: { ...boundary, north: 'x' } }), /boundary\.north must be/);
    refuses(
      layoutDocument({ boundary: { ...boundary, west: 300 } }),
      /west must be less than east/,
    );
    refuses(
      layoutDocument({ boundary: { ...boundary, south: 300 } }),
      /south must be less than north/,
    );
    refuses(
      layoutDocument({ boundary: { ...boundary, radius: -1 } }),
      /radius must not be negative/,
    );
  });

  it('refuses a zone, naming it and the field', () => {
    refuses(layoutDocument({ zones: 'x' }), /"zones" must be an array/);
    refuses(
      layoutDocument({ zones: [dataCenter(), dataCenter()] }),
      /zones\[1\] \(BLD-DC\): duplicate/,
    );
    refuses(
      layoutDocument({ zones: [dataCenter({ name: '' })] }),
      /zones\[0\] \(BLD-DC\)\.name is required/,
    );
    refuses(
      layoutDocument({ zones: [dataCenter({ size: [0, 46] })] }),
      /zones\[0\] \(BLD-DC\)\.size must be two positive numbers/,
    );
    refuses(
      layoutDocument({ zones: [dataCenter({ at: [175, 'x'] })] }),
      /zones\[0\] \(BLD-DC\)\.at must be two finite numbers/,
    );
  });

  it('refuses a building without a height or a use, and a zone that is not a building with either', () => {
    refuses(
      layoutDocument({ zones: [dataCenter({ heightM: undefined })] }),
      /\(BLD-DC\)\.heightM must be a positive number for a building/,
    );
    refuses(
      layoutDocument({ zones: [dataCenter({ heightM: 0 })] }),
      /\(BLD-DC\)\.heightM must be a positive number/,
    );
    refuses(
      layoutDocument({ zones: [dataCenter({ use: undefined })] }),
      /\(BLD-DC\)\.use is required/,
    );
    refuses(
      layoutDocument({ zones: [lawn({ heightM: 5 })], devices: [], catalogue: [] }),
      /zones\[0\] \(OUT-LAWN\): only a building has use and heightM/,
    );
  });

  it('refuses a device, naming it and the field', () => {
    refuses(layoutDocument({ devices: 'x' }), /"devices" must be an array/);
    refuses(
      layoutDocument({ devices: [device(), device()] }),
      /devices\[1\] \(dc-env-01\): duplicate id/,
    );
    refuses(
      layoutDocument({ devices: [device({ zone: 'BLD-NOPE' })] }),
      /devices\[0\] \(dc-env-01\): zone BLD-NOPE is not in "zones"/,
    );
    refuses(
      layoutDocument({ devices: [device({ at: [170] })] }),
      /devices\[0\] \(dc-env-01\)\.at must be two finite numbers/,
    );
    refuses(
      layoutDocument({ devices: [device({ elevationM: -1 })] }),
      /devices\[0\] \(dc-env-01\)\.elevationM must be a number, 0 or more/,
    );
    refuses(
      layoutDocument({ devices: [device({ placement: 'guessed' })] }),
      /devices\[0\] \(dc-env-01\)\.placement must be illustrative or surveyed/,
    );
  });

  it('accepts both placements', () => {
    const parsed = parseTwinLayout(
      layoutDocument({
        devices: [device(), device({ id: 'dc-env-02', placement: 'surveyed' })],
      }),
    );
    assert.deepEqual(
      parsed.devices.map((d) => d.placement),
      ['illustrative', 'surveyed'],
    );
  });

  it('refuses a device inside a building but outside its footprint, which is the zone inset by 8 m', () => {
    // BLD-DC spans east 145 to 205; its footprint spans 153 to 197.
    refuses(
      layoutDocument({ devices: [device({ at: [150, 33] })] }),
      /devices\[0\] \(dc-env-01\)\.at is outside the footprint of BLD-DC/,
    );
    refuses(layoutDocument({ devices: [device({ at: [170, 56] })] }), /outside the footprint/);
    parseTwinLayout(layoutDocument({ devices: [device({ at: [153, 25] })] }));
    parseTwinLayout(layoutDocument({ devices: [device({ at: [197, 55] })] }));
  });

  it('refuses a device above the roof of its building, and any height in a zone with no roof', () => {
    refuses(
      layoutDocument({ devices: [device({ elevationM: 15 })] }),
      /devices\[0\] \(dc-env-01\)\.elevationM is above the roof of BLD-DC/,
    );
    parseTwinLayout(layoutDocument({ devices: [device({ elevationM: 14 })] }));
    parseTwinLayout(
      layoutDocument({ devices: [device({ zone: 'OUT-LAWN', at: [300, 300], elevationM: 40 })] }),
    );
  });

  it('refuses a catalogue asset, naming it and the field', () => {
    refuses(layoutDocument({ catalogue: 'x' }), /"catalogue" must be an array/);
    refuses(
      layoutDocument({ catalogue: [asset(), asset()] }),
      /catalogue\[1\] \(UPS-01\): duplicate code/,
    );
    refuses(
      layoutDocument({ catalogue: [asset({ zone: 'BLD-NOPE' })] }),
      /catalogue\[0\] \(UPS-01\): zone BLD-NOPE is not in "zones"/,
    );
    refuses(
      layoutDocument({ catalogue: [asset({ class: '' })] }),
      /catalogue\[0\] \(UPS-01\)\.class is required/,
    );
    refuses(
      layoutDocument({ catalogue: [asset({ elevationM: -2 })] }),
      /catalogue\[0\] \(UPS-01\)\.elevationM must be a number, 0 or more/,
    );
  });

  it('refuses an asset that claims to be simulated: nothing maps the catalogue to a device yet', () => {
    refuses(
      layoutDocument({ catalogue: [asset({ simulated: true })] }),
      /catalogue\[0\] \(UPS-01\)\.simulated must be false/,
    );
    refuses(
      layoutDocument({ catalogue: [asset({ simulated: undefined })] }),
      /\.simulated must be false/,
    );
  });

  it('accepts an asset outside the footprint of its zone, as the generator stands 3 m from the Data Center', () => {
    const parsed = parseTwinLayout(
      layoutDocument({ catalogue: [asset({ code: 'GEN-01', at: [208, 46.5] })] }),
    );
    assert.equal(parsed.catalogue[0]?.code, 'GEN-01');
  });

  it('accepts empty lists of devices and assets', () => {
    const parsed = parseTwinLayout(layoutDocument({ devices: [], catalogue: [] }));
    assert.deepEqual([parsed.devices, parsed.catalogue], [[], []]);
  });
});

describe('footprintOf', () => {
  it('insets the zone by 8 m on every side', () => {
    assert.deepEqual(footprintOf({ at: [175, 40], size: [60, 46] }), {
      west: 153,
      east: 197,
      south: 25,
      north: 55,
    });
  });

  it('uses the zone itself when a side is too short to inset', () => {
    assert.deepEqual(footprintOf({ at: [0, 0], size: [16, 40] }), {
      west: -8,
      east: 8,
      south: -20,
      north: 20,
    });
  });
});

describe('placementOf', () => {
  const layout = parseTwinLayout(
    layoutDocument({
      devices: [device(), device({ id: 'dc-env-02', at: [170, 47] })],
    }),
  );
  /** Each list keeps the registry's order, and together they are the registry: nothing is dropped. */
  function assertAccountsFor(registry: Registry, placement: ReturnType<typeof placementOf>) {
    const ids = registry.map((d) => d.id);
    const unplacedIds = placement.unplaced.map((u) => u.id);
    assert.deepEqual(
      ids.filter((id) => placement.placed.includes(id)),
      placement.placed,
    );
    assert.deepEqual(
      ids.filter((id) => unplacedIds.includes(id)),
      unplacedIds,
    );
    assert.deepEqual([...placement.placed, ...unplacedIds].sort(), [...ids].sort());
  }

  it('places a device that has a position in the zone the registry gives it', () => {
    const registry: Registry = [
      { id: 'dc-env-01', zoneCode: 'BLD-DC' },
      { id: 'dc-env-02', zoneCode: 'BLD-DC' },
    ];
    const placement = placementOf(layout, registry);
    assert.deepEqual(placement, { placed: ['dc-env-01', 'dc-env-02'], unplaced: [], orphans: [] });
  });

  it('reports a device with no position, with its id and the reason, and does not drop it', () => {
    const registry: Registry = [
      { id: 'dc-env-01', zoneCode: 'BLD-DC' },
      { id: 'dc-env-03', zoneCode: 'BLD-DC' },
      { id: 'dc-env-02', zoneCode: 'BLD-DC' },
    ];
    const placement = placementOf(layout, registry);
    assert.deepEqual(placement.placed, ['dc-env-01', 'dc-env-02']);
    assert.deepEqual(placement.unplaced, [
      { id: 'dc-env-03', reason: 'no position in the layout' },
    ]);
    assertAccountsFor(registry, placement);
  });

  it('reports a device whose zone is not in the layout, even when the layout has a position for it', () => {
    const registry: Registry = [{ id: 'dc-env-01', zoneCode: 'SIM-Z01' }];
    const placement = placementOf(layout, registry);
    assert.deepEqual(placement.unplaced, [
      { id: 'dc-env-01', reason: 'zone SIM-Z01 is not in the layout' },
    ]);
    assertAccountsFor(registry, placement);
  });

  it('reports a device the layout puts in another zone than the registry does', () => {
    const registry: Registry = [{ id: 'dc-env-01', zoneCode: 'OUT-LAWN' }];
    const placement = placementOf(layout, registry);
    assert.deepEqual(placement.unplaced, [
      { id: 'dc-env-01', reason: 'the layout puts it in BLD-DC, the registry in OUT-LAWN' },
    ]);
    assertAccountsFor(registry, placement);
  });

  it('names a layout device the registry does not have as an orphan', () => {
    const registry: Registry = [{ id: 'dc-env-01', zoneCode: 'BLD-DC' }];
    assert.deepEqual(placementOf(layout, registry).orphans, ['dc-env-02']);
    assert.deepEqual(placementOf(layout, []), {
      placed: [],
      unplaced: [],
      orphans: ['dc-env-01', 'dc-env-02'],
    });
  });
});

describe('twinLayoutUnavailable', () => {
  it('has no layout and leaves every device of the registry unplaced', () => {
    const registry: Registry = [
      { id: 'a', zoneCode: 'Z1' },
      { id: 'b', zoneCode: 'Z2' },
    ];
    assert.deepEqual(twinLayoutUnavailable('no file', registry), {
      available: false,
      reason: 'no file',
      layout: null,
      placement: {
        placed: [],
        unplaced: [
          { id: 'a', reason: 'the twin layout is not available' },
          { id: 'b', reason: 'the twin layout is not available' },
        ],
        orphans: [],
      },
    });
  });
});

describe('loadTwinLayout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twin-layout-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, content: string) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };
  const registry: Registry = [{ id: 'dc-env-01', zoneCode: 'BLD-DC' }];

  it('reads a valid file and places the registry against it', () => {
    const path = write('ok.json', JSON.stringify(layoutDocument()));
    const view = loadTwinLayout(path, registry);
    assert.equal(view.available, true);
    assert.equal(view.reason, null);
    assert.equal(view.layout?.zones.length, 2);
    assert.deepEqual(view.placement, { placed: ['dc-env-01'], unplaced: [], orphans: [] });
  });

  it('is still available when the registry and the layout disagree: that is reported, not refused', () => {
    const path = write('disagree.json', JSON.stringify(layoutDocument()));
    const view = loadTwinLayout(path, [{ id: 'other-01', zoneCode: 'BLD-DC' }]);
    assert.equal(view.available, true);
    assert.deepEqual(view.placement.unplaced, [
      { id: 'other-01', reason: 'no position in the layout' },
    ]);
    assert.deepEqual(view.placement.orphans, ['dc-env-01']);
  });

  it('says why a file that is missing is not available, and does not throw', () => {
    const path = join(dir, 'missing.json');
    const view = loadTwinLayout(path, registry);
    assert.equal(view.available, false);
    assert.equal(view.reason, `cannot read ${path} (ENOENT)`);
    assert.equal(view.placement.unplaced.length, 1);
  });

  it('says why a directory is not available', () => {
    const path = join(dir, 'folder');
    mkdirSync(path);
    const view = loadTwinLayout(path, registry);
    assert.equal(view.available, false);
    assert.match(view.reason ?? '', /cannot read .*folder \(EISDIR\)/);
  });

  it('says why a file that is not JSON is not available', () => {
    const path = write('broken.json', '{ not json');
    const view = loadTwinLayout(path, registry);
    assert.equal(view.reason, `${path} is not valid JSON`);
  });

  it('says why a file that is JSON but not a layout is not available, naming the field', () => {
    const path = write(
      'unusable.json',
      JSON.stringify(layoutDocument({ devices: [device({ at: [150, 33] })] })),
    );
    const view = loadTwinLayout(path, registry);
    assert.equal(view.available, false);
    assert.equal(view.layout, null);
    assert.match(
      view.reason ?? '',
      /is not usable: devices\[0\] \(dc-env-01\)\.at is outside the footprint/,
    );
    assert.ok((view.reason ?? '').startsWith(path));
  });

  it('refuses a file larger than the limit without reading it', () => {
    const path = write('huge.json', ' '.repeat(MAX_LAYOUT_BYTES + 1));
    const view = loadTwinLayout(path, registry);
    assert.equal(view.available, false);
    assert.match(view.reason ?? '', /is too large/);
  });
});

// The files of the repository, read by URL as registry-100.test.ts reads its fixture.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const layoutPath = fileURLToPath(new URL('../config/twin-layout.json', import.meta.url));
const ingestRegistry = (
  JSON.parse(read('../../ingest/config/devices.json')) as { devices: DeviceSpec[] }
).devices;
const registry100 = (
  JSON.parse(read('../fixtures/devices-100/devices.json')) as { devices: DeviceSpec[] }
).devices;

describe('config/twin-layout.json', () => {
  const view = loadTwinLayout(layoutPath, ingestRegistry);
  const layout = view.layout;

  it('is available and says where it was copied from', () => {
    assert.equal(view.reason, null, view.reason ?? '');
    assert.equal(view.available, true);
    assert.ok(layout);
    assert.equal(layout.source.repository, 'ops-command-center');
    assert.match(layout.source.commit, /^[0-9a-f]{40}$/);
    assert.deepEqual(layout.source.files, [
      'apps/api/src/database/seed/campus.ts',
      'apps/api/src/database/seed/assets.ts',
    ]);
  });

  it("holds the command center's 20 zones, 12 of them buildings, and its 31 assets, none of them simulated", () => {
    assert.ok(layout);
    assert.equal(layout.zones.length, 20);
    assert.equal(layout.zones.filter((zone) => zone.kind === 'building').length, 12);
    assert.equal(layout.catalogue.length, 31);
    assert.equal(layout.catalogue.filter((a) => a.class === 'indoor_climate').length, 9);
    assert.equal(layout.catalogue.filter((a) => a.zone === 'BLD-DC').length, 8);
    assert.ok(layout.catalogue.every((a) => a.simulated === false));
  });

  it('puts the data center where the command center does', () => {
    assert.deepEqual(
      layout?.zones.find((zone) => zone.code === 'BLD-DC'),
      {
        code: 'BLD-DC',
        name: 'Data Center',
        kind: 'building',
        use: 'data_center',
        heightM: 14,
        at: [175, 40],
        size: [60, 46],
      },
    );
  });

  it("places every device of ingest's devices.json in the zone devices.json gives it, and no other", () => {
    assert.ok(layout);
    for (const device of ingestRegistry) {
      assert.ok(
        layout.zones.some((zone) => zone.code === device.zoneCode),
        `${device.id}: zone ${device.zoneCode} is in the layout`,
      );
      const position: TwinDevice | undefined = layout.devices.find((d) => d.id === device.id);
      assert.equal(position?.zone, device.zoneCode, `${device.id} is placed in its zone`);
    }
    assert.deepEqual(view.placement, {
      placed: ingestRegistry.map((device) => device.id),
      unplaced: [],
      orphans: [],
    });
  });

  it('marks the placement of every device', () => {
    assert.ok(layout);
    assert.ok(
      layout.devices.every((d) => d.placement === 'illustrative' || d.placement === 'surveyed'),
    );
  });

  it('reports the devices of the 100-device registry it has no position for, and drops none', () => {
    assert.ok(layout);
    const placement = placementOf(layout, registry100);
    assert.equal(registry100.length, 100);
    assert.deepEqual(
      placement.placed,
      ingestRegistry.map((device) => device.id),
    );
    assert.equal(placement.unplaced.length, 94);
    assert.equal(placement.placed.length + placement.unplaced.length, 100);
    assert.deepEqual(placement.orphans, []);
    const zoneOf = new Map(registry100.map((device) => [device.id, device.zoneCode]));
    for (const { id, reason } of placement.unplaced) {
      const zone = zoneOf.get(id) ?? '';
      assert.equal(
        reason,
        zone.startsWith('SIM-Z')
          ? `zone ${zone} is not in the layout`
          : 'no position in the layout',
        id,
      );
    }
  });
});

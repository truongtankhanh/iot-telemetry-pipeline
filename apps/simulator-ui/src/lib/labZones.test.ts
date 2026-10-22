import { describe, expect, it } from 'vitest';
import type { DeviceInfo, ObservedAlert } from '../api/types';
import { type DeviceStatusKind, STATUS_WORDS } from './deviceStatus';
import type { FleetRow } from './fleetQuery';
import { filterZones, startedText, stateBar, zoneLine, zoneRows, zoneTable } from './labZones';

const rowOf = (
  id: string,
  zone: string,
  kind: DeviceStatusKind = 'running',
  deviceKind = 'indoor_air',
): FleetRow => {
  const device: DeviceInfo = { id, kind: deviceKind, zoneCode: zone, metrics: ['temperature_c'] };
  return {
    device,
    name: id,
    code: id.slice(0, 3),
    status: {
      kind,
      node: kind === 'running' ? 'healthy' : 'paused',
      word: STATUS_WORDS[kind],
      since: null,
      reason: null,
    },
    readings: [],
    lastSeen: null,
  };
};

/** 100 devices in 20 zones of 5, the first three zones with problems of different kinds. */
const hundred: FleetRow[] = Array.from({ length: 100 }, (_, i) => {
  const zone = `Z${String(Math.floor(i / 5) + 1).padStart(2, '0')}`;
  const kind: DeviceStatusKind =
    i === 0 ? 'anomaly' : i === 6 ? 'paused' : i === 7 ? 'silent' : 'running';
  return rowOf(`d${String(i + 1).padStart(3, '0')}`, zone, kind);
});

describe('zoneRows', () => {
  it('makes one row per zone with its count, its worst state and its states counted', () => {
    const zones = zoneRows(hundred, new Set());
    expect(zones).toHaveLength(20);
    const z01 = zones.find((z) => z.zone === 'Z01')!;
    expect(z01).toMatchObject({ count: 5, worst: 'anomaly', problems: 1, targeted: 0 });
    expect(z01.counts).toEqual({ healthy: 4, anomaly: 1, down: 0, stale: 0 });
  });

  it('puts the worst zone first, then the one with more problems, then by code', () => {
    const zones = zoneRows(hundred, new Set());
    expect(zones.slice(0, 3).map((z) => [z.zone, z.worst, z.problems])).toEqual([
      ['Z01', 'anomaly', 1],
      ['Z02', 'stale', 2],
      ['Z03', 'healthy', 0],
    ]);
    expect(zones.slice(2).map((z) => z.zone)).toEqual(
      Array.from({ length: 18 }, (_, i) => `Z${String(i + 3).padStart(2, '0')}`),
    );
  });

  it('counts the devices of each zone that the fault is aimed at', () => {
    const targets = new Set(['d001', 'd002', 'd003', 'd011']);
    const zones = zoneRows(hundred, targets);
    expect(zones.find((z) => z.zone === 'Z01')?.targeted).toBe(3);
    expect(zones.find((z) => z.zone === 'Z03')?.targeted).toBe(1);
    expect(zones.reduce((sum, z) => sum + z.targeted, 0)).toBe(4);
  });

  it('is empty for no devices', () => {
    expect(zoneRows([], new Set())).toEqual([]);
  });
});

describe('filterZones', () => {
  const zones = zoneRows(hundred, new Set());

  it('searches by the code of the zone', () => {
    expect(filterZones(zones, { q: 'z1', problemsOnly: false }).map((z) => z.zone)).toEqual([
      'Z10',
      'Z11',
      'Z12',
      'Z13',
      'Z14',
      'Z15',
      'Z16',
      'Z17',
      'Z18',
      'Z19',
    ]);
  });

  it('keeps the zones with a problem when asked', () => {
    expect(filterZones(zones, { q: '', problemsOnly: true }).map((z) => z.zone)).toEqual([
      'Z01',
      'Z02',
    ]);
  });

  it('keeps everything for an empty search', () => {
    expect(filterZones(zones, { q: '  ', problemsOnly: false })).toHaveLength(20);
  });
});

describe('stateBar and zoneLine', () => {
  it('gives the states that are present, in a fixed order, with shares that add up to 1', () => {
    const bar = stateBar({ healthy: 14, anomaly: 6, down: 0, stale: 2 });
    expect(bar.map((s) => [s.state, s.count])).toEqual([
      ['healthy', 14],
      ['anomaly', 6],
      ['stale', 2],
    ]);
    expect(bar.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
    expect(bar[0]!.share).toBeCloseTo(14 / 22, 10);
  });

  it('has no bar for no devices', () => {
    expect(stateBar({ healthy: 0, anomaly: 0, down: 0, stale: 0 })).toEqual([]);
  });

  it('says how many devices, and how many are targeted', () => {
    const [z01] = zoneRows(hundred, new Set(['d001', 'd002']));
    expect(zoneLine(z01!)).toBe('5 devices · 2 targeted');
    expect(zoneLine({ ...z01!, targeted: 0, count: 1 })).toBe('1 device');
  });
});

describe('zoneTable', () => {
  const engine = {
    elapsedS: 100,
    anomalies: [
      {
        id: 'a1',
        anomaly: {
          deviceId: 'd001',
          metric: 'temperature_c' as const,
          value: 29,
          startAt: 80,
          duration: 60,
        },
      },
      {
        id: 'a2',
        anomaly: {
          deviceId: 'd002',
          metric: 'temperature_c' as const,
          value: 29,
          startAt: 112,
          duration: 60,
          shape: 'ramp' as const,
        },
      },
      {
        id: 'a3',
        anomaly: {
          deviceId: 'd003',
          metric: 'temperature_c' as const,
          value: 29,
          startAt: 10,
          duration: 20,
        },
      },
    ],
  };
  const alert = (
    id: string,
    deviceId: string,
    status: 'open' | 'cleared',
    openedAt: string,
  ): ObservedAlert => ({ id, deviceId, status, openedAt }) as unknown as ObservedAlert;
  const alerts = [
    alert('7', 'd001', 'open', '2026-10-21T09:14:15.000Z'),
    alert('6', 'd001', 'open', '2026-10-21T09:10:00.000Z'),
    alert('5', 'd002', 'cleared', '2026-10-21T09:00:00.000Z'),
  ];
  const input = {
    rows: hundred,
    zone: 'Z01',
    tab: 'all' as const,
    targets: new Set(['d001', 'd002']),
    engine,
    alerts,
  };

  it('lists the devices of the zone, problems first, each with its fault, when it starts and its open alert', () => {
    const table = zoneTable(input);
    expect(table.rows.map((r) => r.row.device.id)).toEqual([
      'd001',
      'd002',
      'd003',
      'd004',
      'd005',
    ]);
    const [first, second, third] = table.rows;
    expect(first).toMatchObject({ targeted: true, fault: 'Breach · step', started: '20 s ago' });
    expect(first?.alert?.id).toBe('7');
    expect(second).toMatchObject({ fault: 'Breach · ramp', started: 'in 12 s', alert: null });
    expect(third).toMatchObject({ targeted: false, fault: null, started: null });
  });

  it('counts the tabs, and shows the targets or the problems only on those tabs', () => {
    expect(zoneTable(input).counts).toEqual({ all: 5, targets: 2, problems: 1 });
    expect(zoneTable({ ...input, tab: 'targets' }).rows.map((r) => r.row.device.id)).toEqual([
      'd001',
      'd002',
    ]);
    expect(zoneTable({ ...input, tab: 'problems' }).rows.map((r) => r.row.device.id)).toEqual([
      'd001',
    ]);
  });

  it('follows the search in the rows and in the counts', () => {
    const table = zoneTable({ ...input, q: 'd004' });
    expect(table.rows.map((r) => r.row.device.id)).toEqual(['d004']);
    expect(table.counts).toEqual({ all: 1, targets: 0, problems: 0 });
  });

  it('is empty for a zone that is not there', () => {
    expect(zoneTable({ ...input, zone: 'nope' })).toEqual({
      rows: [],
      counts: { all: 0, targets: 0, problems: 0 },
    });
  });
});

describe('startedText', () => {
  it('says in how long, or how long ago', () => {
    expect(startedText(112, 100)).toBe('in 12 s');
    expect(startedText(80, 100)).toBe('20 s ago');
    expect(startedText(100, 100)).toBe('0 s ago');
  });
});

import { describe, expect, it } from 'vitest';
import type { ObservationEvent } from '../api/types';
import {
  collapseRuns,
  filterRows,
  type LabCommand,
  logCounts,
  logRows,
  RUN_KEEP,
  RUN_MIN,
  stepTarget,
} from './labLog';

const at = (second: number) => new Date(Date.UTC(2026, 9, 21, 9, 14, second)).toISOString();

const alertOpened = (id: number, alertId: number, second: number): ObservationEvent => ({
  id,
  at: at(second),
  kind: 'alert-opened',
  data: {
    alertId: String(alertId),
    deviceId: `dev-${alertId}`,
    ruleId: 'server-room-hot',
    severity: 'high',
    title: 'Hot',
  },
});

const anomalyAdded = (id: number, second: number): ObservationEvent => ({
  id,
  at: at(second),
  kind: 'engine-state',
  data: {
    type: 'anomaly-added',
    id: `a${id}`,
    anomaly: { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2 },
  },
});

const command = (
  id: string,
  second: number,
  text = 'Injected a breach on 12 devices',
): LabCommand => ({
  id,
  at: Date.parse(at(second)),
  kind: 'inject',
  text,
  devices: ['dc-env-01'],
});

describe('logRows', () => {
  const events: ObservationEvent[] = [
    {
      id: 9,
      at: at(30),
      kind: 'engine-state',
      data: { type: 'device-state', deviceId: 'x', state: 'paused' },
    },
    alertOpened(8, 7, 20),
    anomalyAdded(7, 10),
    { id: 6, at: at(5), kind: 'dependency', data: {} },
    {
      id: 5,
      at: at(4),
      kind: 'delivery',
      data: { alertId: '7', phase: 'opened', status: 'delivered' },
    },
  ];

  it('keeps what concerns faults and alerts, leaves the rest to the Overview, and merges the commands by time', () => {
    const rows = logRows(events, [command('c1', 15)]);
    expect(rows.map((r) => [r.kind, r.group])).toEqual([
      ['alert-opened', 'alerts'],
      ['command', 'faults'],
      ['engine-state', 'faults'],
      ['delivery', 'alerts'],
    ]);
  });

  it('gives each row a key of its own, the alert it names and the devices it concerns', () => {
    const rows = logRows(events, [command('c1', 15)]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows[0]).toMatchObject({ alertId: '7' });
    expect(rows[1]).toMatchObject({
      event: null,
      devices: ['dc-env-01'],
      message: 'Injected a breach on 12 devices',
    });
    expect(rows[2]!.devices).toEqual(['dc-env-01']);
  });

  it('never makes a "Rule raised" or an "Anomaly started" row', () => {
    const text = logRows(events, [])
      .map((r) => r.message)
      .join('\n');
    expect(text).not.toMatch(/Rule .* raised|Anomaly started/);
  });

  it('is empty for nothing', () => {
    expect(logRows([], [])).toEqual([]);
  });
});

describe('filterRows and logCounts', () => {
  const rows = logRows(
    [alertOpened(3, 1, 3), anomalyAdded(2, 2), alertOpened(1, 2, 1)],
    [command('c1', 4)],
  );

  it('counts All, Alerts and Faults', () => {
    expect(logCounts(rows)).toEqual({ all: 4, alerts: 2, faults: 2 });
  });

  it('filters', () => {
    expect(filterRows(rows, 'all')).toHaveLength(4);
    expect(filterRows(rows, 'alerts').every((r) => r.group === 'alerts')).toBe(true);
    expect(filterRows(rows, 'faults').map((r) => r.kind)).toEqual(['command', 'engine-state']);
  });
});

describe('collapseRuns', () => {
  const alerts = Array.from({ length: 9 }, (_, i) => alertOpened(100 - i, 15 - i, 50 - i));
  const rows = logRows(alerts, []);

  it('shows a short run row by row', () => {
    const short = collapseRuns(rows.slice(0, RUN_MIN - 1), new Set());
    expect(short.every((item) => item.type === 'row')).toBe(true);
    expect(short).toHaveLength(RUN_MIN - 1);
  });

  it('folds a long run behind its newest rows, and names the alerts it holds', () => {
    const items = collapseRuns(rows, new Set());
    expect(items.map((i) => i.type)).toEqual(['row', 'row', 'run']);
    const run = items[2]!;
    if (run.type !== 'run') throw new Error('expected a run');
    expect(run.count).toBe(9 - RUN_KEEP);
    expect(run.label).toBe('7 more alerts, #7 to #13');
    expect(run.rows).toHaveLength(7);
  });

  it('shows the run row by row once it is opened', () => {
    const run = collapseRuns(rows, new Set()).at(-1)!;
    if (run.type !== 'run') throw new Error('expected a run');
    const items = collapseRuns(rows, new Set([run.key]));
    expect(items).toHaveLength(9);
    expect(items.every((i) => i.type === 'row')).toBe(true);
  });

  it('only folds rows of one kind that follow each other', () => {
    const mixed = logRows(
      [
        alertOpened(9, 9, 9),
        alertOpened(8, 8, 8),
        anomalyAdded(7, 7),
        alertOpened(6, 6, 6),
        alertOpened(5, 5, 5),
        alertOpened(4, 4, 4),
      ],
      [],
    );
    expect(collapseRuns(mixed, new Set()).every((i) => i.type === 'row')).toBe(true);
  });

  it('says plainly how many when the rows do not name alerts by number', () => {
    const commands = Array.from({ length: 6 }, (_, i) => command(`c${i}`, 10 - i));
    const items = collapseRuns(logRows([], commands), new Set());
    const run = items.at(-1)!;
    expect(run.type === 'run' && run.label).toBe('4 more commands');
  });
});

describe('stepTarget', () => {
  const targets = ['a', 'b', 'c'];

  it('is on the first target when none is current, and says its place', () => {
    expect(stepTarget(targets, null)).toEqual({ id: 'a', position: 1, total: 3 });
  });

  it('moves one at a time and stops at the ends', () => {
    expect(stepTarget(targets, 'a', 1)).toEqual({ id: 'b', position: 2, total: 3 });
    expect(stepTarget(targets, 'c', 1)).toEqual({ id: 'c', position: 3, total: 3 });
    expect(stepTarget(targets, 'a', -1)).toEqual({ id: 'a', position: 1, total: 3 });
  });

  it('drops a target that is no longer there for the first', () => {
    expect(stepTarget(targets, 'gone', 0)).toEqual({ id: 'a', position: 1, total: 3 });
  });

  it('has nothing for no targets', () => {
    expect(stepTarget([], 'a')).toEqual({ id: null, position: 0, total: 0 });
  });
});

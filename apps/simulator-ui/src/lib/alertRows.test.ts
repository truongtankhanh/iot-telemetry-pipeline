import { describe, expect, it } from 'vitest';
import type { ObservedAlert, PagedAlert } from '../api/types';
import { filterBySeverity, filterNote, ingestFields, overlayLive, severityOf } from './alertRows';

const T = (second: number) => `2026-10-20T08:00:${String(second).padStart(2, '0')}.000Z`;

function alert(overrides: Partial<PagedAlert> = {}): PagedAlert {
  return {
    id: '7',
    deviceId: 'dc-env-01',
    ruleId: 'server-room-hot',
    metric: 'temperature_c',
    severity: 'high',
    title: 'Server room temperature high',
    status: 'open',
    openedAt: T(26),
    openedValue: 29.3,
    clearedAt: null,
    clearedValue: null,
    externalRef: null,
    deliveryStatus: 'pending',
    deliveryAttempts: 0,
    deliveryError: null,
    preexisting: false,
    observed: {
      openedAt: T(27),
      clearedAt: null,
      delivered: { opened: null, cleared: null },
      incident: null,
    },
    cause: null,
    ...overrides,
  };
}

/** What the store holds: the same alert without a cause. */
const live = (overrides: Partial<ObservedAlert> = {}): ObservedAlert => {
  const { cause, ...rest } = alert();
  void cause;
  return { ...rest, ...overrides };
};

describe('severityOf', () => {
  it('keeps the four severities and draws an unknown one as the lowest', () => {
    expect(['critical', 'high', 'medium', 'low'].map(severityOf)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ]);
    expect(severityOf('catastrophic')).toBe('low');
    expect(severityOf('')).toBe('low');
  });
});

describe('overlayLive', () => {
  const delivered = live({
    deliveryStatus: 'delivered',
    deliveryAttempts: 1,
    externalRef: 'inc-7',
    observed: {
      openedAt: T(27),
      clearedAt: null,
      delivered: { opened: T(28), cleared: null },
      incident: T(28),
    },
  });

  it('puts a delivery that happened after the page was fetched onto the row, and keeps its cause', () => {
    const row = alert({ cause: { scenario: 'overheat', startedAt: T(0) } });
    const [merged] = overlayLive([row], [delivered]);
    expect(merged?.deliveryStatus).toBe('delivered');
    expect(merged?.externalRef).toBe('inc-7');
    expect(merged?.observed.incident).toBe(T(28));
    expect(merged?.cause).toEqual({ scenario: 'overheat', startedAt: T(0) });
  });

  it('puts a clear that happened after the page was fetched onto the row', () => {
    const cleared = live({
      status: 'cleared',
      clearedAt: T(90),
      clearedValue: 25.1,
      observed: { ...live().observed, clearedAt: T(91) },
    });
    const [merged] = overlayLive([alert()], [cleared]);
    expect(merged?.status).toBe('cleared');
    expect(merged?.clearedValue).toBe(25.1);
  });

  it('never lets an older copy win: a page fetched since the store last heard is kept as it is', () => {
    const fresherPage = alert({
      deliveryStatus: 'delivered',
      externalRef: 'inc-7',
      observed: delivered.observed,
    });
    const [kept] = overlayLive([fresherPage], [live()]);
    expect(kept).toBe(fresherPage);
  });

  it('keeps a row the store does not know, and a row equal to its copy, as the same object', () => {
    const unknown = alert({ id: '3' });
    const equal = alert({ id: '4' });
    const result = overlayLive([unknown, equal], [live({ id: '4' })]);
    expect(result[0]).toBe(unknown);
    expect(result[1]).toBe(equal);
  });

  it('returns a new list and leaves its inputs alone', () => {
    const page = [alert()];
    const before = structuredClone(page);
    const result = overlayLive(page, [delivered]);
    expect(result).not.toBe(page);
    expect(page).toEqual(before);
    expect(overlayLive(page, [])).not.toBe(page);
  });
});

describe('the severity filter', () => {
  const rows = [
    alert({ id: '1', severity: 'high' }),
    alert({ id: '2', severity: 'low' }),
    alert({ id: '3', severity: 'high' }),
    alert({ id: '4', severity: 'surprising' }),
  ];

  it('keeps every row for all, and only the matching ones otherwise', () => {
    expect(filterBySeverity(rows, 'all')).toHaveLength(4);
    expect(filterBySeverity(rows, 'high').map((r) => r.id)).toEqual(['1', '3']);
    expect(filterBySeverity(rows, 'critical')).toEqual([]);
  });

  it('counts an unknown severity with the lowest, as the badge draws it', () => {
    expect(filterBySeverity(rows, 'low').map((r) => r.id)).toEqual(['2', '4']);
  });

  it('says how many rows of the page it hides, and nothing when it hides none', () => {
    expect(filterNote(2, 4)).toBe('Filtering this page: 2 of 4 shown.');
    expect(filterNote(0, 5)).toBe('Filtering this page: 0 of 5 shown.');
    expect(filterNote(4, 4)).toBeNull();
  });
});

describe('ingestFields', () => {
  it('has the fields of ingest’s alert, in its order, and nothing Studio added', () => {
    const fields = ingestFields(alert({ cause: { scenario: 'x', startedAt: T(0) } }));
    expect(Object.keys(fields)).toEqual([
      'id',
      'deviceId',
      'ruleId',
      'metric',
      'severity',
      'title',
      'status',
      'openedAt',
      'openedValue',
      'clearedAt',
      'clearedValue',
      'externalRef',
      'deliveryStatus',
      'deliveryAttempts',
      'deliveryError',
    ]);
    expect(JSON.stringify(fields)).not.toMatch(/observed|preexisting|cause/);
  });
});

import { nextDelayMs } from '../delivery/backoff';
import {
  acceptedWindow,
  expiredPartitions,
  partitionName,
  requiredDays,
} from '../maintenance/partitions';
import { rollup } from './rollup';
import { SequenceTracker } from './sequence-tracker';

describe('SequenceTracker', () => {
  it('counts skipped sequence numbers', () => {
    const t = new SequenceTracker();
    expect([1, 2, 5, 6, 10].map((s) => t.observe('d', s))).toEqual([0, 0, 2, 0, 3]);
  });

  it('ignores redeliveries and treats a large step back as a restart', () => {
    const t = new SequenceTracker(100);
    expect(t.observe('d', 500)).toBe(0);
    expect(t.observe('d', 499)).toBe(0); // redelivery
    expect(t.observe('d', 1)).toBe(0); // restart
    expect(t.observe('d', 3)).toBe(1);
  });

  it('tracks devices independently', () => {
    const t = new SequenceTracker();
    t.observe('a', 1);
    t.observe('b', 7);
    expect(t.observe('a', 3)).toBe(1);
    expect(t.observe('b', 8)).toBe(0);
  });
});

describe('rollup', () => {
  it('aggregates per device, metric and minute', () => {
    const at = (s: string) => new Date(`2026-10-01T08:${s}Z`);
    const rows = rollup([
      { deviceId: 'd', metric: 't', ts: at('00:10'), value: 20 },
      { deviceId: 'd', metric: 't', ts: at('00:50'), value: 24 },
      { deviceId: 'd', metric: 't', ts: at('01:05'), value: 30 },
      { deviceId: 'd', metric: 'h', ts: at('00:10'), value: 40 },
    ]);
    expect(rows).toEqual(
      expect.arrayContaining([
        { deviceId: 'd', metric: 't', bucket: at('00:00'), count: 2, sum: 44, min: 20, max: 24 },
        { deviceId: 'd', metric: 't', bucket: at('01:00'), count: 1, sum: 30, min: 30, max: 30 },
        { deviceId: 'd', metric: 'h', bucket: at('00:00'), count: 1, sum: 40, min: 40, max: 40 },
      ]),
    );
    expect(rows).toHaveLength(3);
  });
});

describe('partitions', () => {
  const now = new Date('2026-10-01T15:30:00Z');

  it('keeps two days back and two ahead', () => {
    expect(requiredDays(now).map(partitionName)).toEqual([
      'reading_20260929',
      'reading_20260930',
      'reading_20261001',
      'reading_20261002',
      'reading_20261003',
    ]);
  });

  it('never accepts readings older than the oldest kept partition or retention', () => {
    expect(acceptedWindow(now, 30).from.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(acceptedWindow(now, 1).from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('expires only well-formed partitions older than retention', () => {
    const existing = ['reading_20260830', 'reading_20260831', 'reading_20260901', 'reading_old'];
    expect(expiredPartitions(existing, now, 30)).toEqual(['reading_20260830', 'reading_20260831']);
  });
});

describe('nextDelayMs', () => {
  it('grows exponentially with jitter and is capped at ten minutes', () => {
    expect(nextDelayMs(1, () => 0)).toBe(1000);
    expect(nextDelayMs(1, () => 1)).toBe(2000);
    expect(nextDelayMs(4, () => 1)).toBe(16_000);
    expect(nextDelayMs(30, () => 1)).toBe(600_000);
  });
});

import { nextDelayMs } from '../delivery/backoff';
import {
  acceptedWindow,
  expiredPartitions,
  partitionName,
  requiredDays,
} from '../maintenance/partitions';
import { rollup } from './rollup';
import { applySequences, type DeviceSequence, MAX_HOLES } from './sequence-ledger';

describe('applySequences', () => {
  const fresh: DeviceSequence = { last: null, lastTs: null, holes: [] };
  /** Messages whose timestamp grows with the sequence number, as a device's clock does. */
  const msgs = (...seqs: number[]) => seqs.map((seq) => ({ seq, ts: seq * 1000 }));

  it('confirms skipped sequence numbers once, after the grace period', () => {
    const first = applySequences(fresh, msgs(1, 2, 5, 6, 10), 0, 1000);
    expect(first.lost).toBe(0);
    expect(first.state.holes).toEqual([
      [3, 4, 0],
      [7, 9, 0],
    ]);
    const settled = applySequences(first.state, [], 1000, 1000);
    expect(settled.lost).toBe(5);
    expect(applySequences(settled.state, [], 5000, 1000).lost).toBe(0);
  });

  it('counts at once with no grace period', () => {
    expect(applySequences(fresh, msgs(1, 2, 5, 6, 10), 0, 0).lost).toBe(5);
  });

  it('does not count a message that arrives after its successor, across flushes', () => {
    // Two replicas share a device: B flushes seq 6 before A flushes seq 5.
    const a = applySequences(fresh, msgs(1, 2, 3, 4), 0, 1000);
    const b = applySequences(a.state, msgs(6), 100, 1000);
    expect(b.state.holes).toEqual([[5, 5, 100]]);
    const late = applySequences(b.state, msgs(5), 200, 1000);
    expect(late.state.holes).toEqual([]);
    expect(applySequences(late.state, msgs(7), 60_000, 1000).lost).toBe(0);
  });

  it('does not count a message that arrives out of order inside one batch', () => {
    const { state, lost } = applySequences(fresh, msgs(1, 2, 4, 3, 5), 0, 0);
    expect(lost).toBe(0);
    expect(state).toMatchObject({ last: 5, holes: [] });
  });

  it('splits a hole when the late message falls in its middle', () => {
    const jumped = applySequences({ last: 1, lastTs: 1000, holes: [] }, msgs(6), 0, 1000);
    const { state, lost } = applySequences(jumped.state, msgs(4), 10, 1000);
    expect(state.holes).toEqual([
      [2, 3, 0],
      [5, 5, 0],
    ]);
    expect(lost).toBe(0);
    expect(applySequences(state, [], 1000, 1000).lost).toBe(3);
  });

  it('ignores a redelivery', () => {
    const state = { last: 500, lastTs: 500_000, holes: [] };
    const result = applySequences(state, msgs(499, 500), 0, 0);
    expect(result.lost).toBe(0);
    expect(result.state.last).toBe(500);
  });

  it('is not fooled by a late message far behind the newest one', () => {
    // A lagging flush delivers messages thousands behind the newest: a late arrival, not a restart.
    const jumped = applySequences(fresh, msgs(1, 2, 3, 5000), 0, 1000);
    const late = applySequences(jumped.state, msgs(2, 2500), 10, 1000);
    expect(late.lost).toBe(0);
    expect(late.state.last).toBe(5000);
    expect(late.state.holes).toEqual([
      [4, 2499, 0],
      [2501, 4999, 0],
    ]);
  });

  it('treats a lower, newer message as a restart and closes the old holes as lost', () => {
    const opened = applySequences(
      { last: 2000, lastTs: 2_000_000, holes: [] },
      msgs(2003),
      0,
      1000,
    );
    const restarted = applySequences(opened.state, [{ seq: 1, ts: 3_000_000 }], 10, 1000);
    expect(restarted.lost).toBe(2);
    expect(restarted.state).toEqual({ last: 1, lastTs: 3_000_000, holes: [] });
    expect(applySequences(restarted.state, [{ seq: 3, ts: 3_002_000 }], 20, 0).lost).toBe(1);
    const back = applySequences(
      { last: 10, lastTs: 10_000, holes: [] },
      [{ seq: 0, ts: 20_000 }],
      0,
      0,
    );
    expect(back.state.last).toBe(0);
  });

  it('bounds the holes it keeps by confirming the oldest early', () => {
    const seqs = Array.from({ length: MAX_HOLES + 3 }, (_, i) => i * 2);
    const { state, lost } = applySequences(fresh, msgs(...seqs), 0, 1000);
    expect(state.holes).toHaveLength(MAX_HOLES);
    expect(lost).toBe(2);
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

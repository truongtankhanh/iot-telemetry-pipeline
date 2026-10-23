import { describe, expect, it } from 'vitest';
import type { FaultEffectView, FaultsSnapshot, MetricSample, MetricsFeed } from '../api/types';
import { stateViewFixture } from '../api/fixtures/stateView';
import { deltaText, faultEffect } from './faultEffect';

const off: FaultsSnapshot = structuredClone(stateViewFixture.engine.faults);
const faults = (changes: Partial<FaultsSnapshot> = {}): FaultsSnapshot => ({ ...off, ...changes });

const sample = (
  name: string,
  value: number,
  labels: Record<string, string> = {},
): MetricSample => ({
  name,
  labels,
  value,
});
const gaps = (value: number) => sample('telemetry_sequence_gaps_total', value);
const messages = (result: string, value: number) =>
  sample('telemetry_messages_total', value, { result });
const readings = (result: string, value: number) =>
  sample('telemetry_readings_total', value, { result });
const rejected = (reason: string, value: number) =>
  sample('telemetry_rejections_total', value, { reason });

const feed = (samples: MetricSample[], overrides: Partial<MetricsFeed> = {}): MetricsFeed => ({
  samples,
  lastOkAt: '2026-10-23T08:05:00.000Z',
  stale: false,
  ...overrides,
});
const effect = (baseline: MetricSample[] | null): FaultEffectView => ({
  since: '2026-10-23T08:00:00.000Z',
  baseline,
});

const BASELINE = [
  gaps(4),
  messages('accepted', 100),
  messages('rejected', 10),
  readings('stored', 220),
  readings('duplicate', 3),
  rejected('range', 6),
  rejected('json', 4),
];
const NOW = [
  gaps(29),
  messages('accepted', 560),
  messages('rejected', 24),
  readings('stored', 460),
  readings('duplicate', 12),
  rejected('range', 20),
  rejected('json', 4),
];

const row = (model: ReturnType<typeof faultEffect>, id: string) =>
  model.rows.find((r) => r.id === id);

describe('faultEffect', () => {
  it('has nothing before a fault has been switched on', () => {
    expect(faultEffect({ faults: off, effect: null, metrics: feed(NOW) })).toEqual({
      status: 'none',
      since: null,
      rows: [],
      notes: [],
    });
  });

  it('is the change of the four counters since the baseline', () => {
    const model = faultEffect({
      faults: faults({ drop: { percent: 5 }, malformed: { percent: 3, kinds: ['range'] } }),
      effect: effect(BASELINE),
      metrics: feed(NOW),
    });
    expect(model.status).toBe('ready');
    expect(model.since).toBe('2026-10-23T08:00:00.000Z');
    expect(row(model, 'gaps')?.delta).toBe(25);
    expect(row(model, 'rejections:range')?.delta).toBe(14);
    // Messages are the sum over accepted and rejected; readings only the ones stored.
    expect(row(model, 'messages')?.delta).toBe(474);
    expect(row(model, 'readings')?.delta).toBe(240);
    expect(row(model, 'duplicates')?.delta).toBe(9);
  });

  it('shows a message sent again as stored +0 and duplicate +n, one per metric', () => {
    // A message with two metrics was republished: one more message, no new reading, two repeats.
    const model = faultEffect({
      faults: off,
      effect: effect(BASELINE),
      metrics: feed(
        BASELINE.map((s) => {
          if (s.name === 'telemetry_messages_total' && s.labels.result === 'accepted') {
            return { ...s, value: s.value + 1 };
          }
          if (s.name === 'telemetry_readings_total' && s.labels.result === 'duplicate') {
            return { ...s, value: s.value + 2 };
          }
          return s;
        }),
      ),
    });
    expect(row(model, 'readings')?.delta).toBe(0);
    expect(row(model, 'duplicates')?.delta).toBe(2);
    expect(row(model, 'duplicates')?.detail).toBe('the same reading arriving again, ignored');
    expect(row(model, 'messages')?.delta).toBe(1);
  });

  it('counts the duplicates as 0 when ingest has not exported that series yet, and says "—" when it started again', () => {
    const fresh = faultEffect({
      faults: off,
      effect: effect([gaps(0), readings('stored', 10)]),
      metrics: feed([gaps(0), readings('stored', 10)]),
    });
    expect(row(fresh, 'duplicates')?.delta).toBe(0);

    const restarted = faultEffect({
      faults: off,
      effect: effect([readings('duplicate', 50)]),
      metrics: feed([readings('duplicate', 2)]),
    });
    expect(row(restarted, 'duplicates')).toMatchObject({ delta: null, restarted: true });
  });

  it('has no duplicates row before a fault has been switched on', () => {
    expect(faultEffect({ faults: off, effect: null, metrics: feed(NOW) }).rows).toEqual([]);
  });

  it('puts the rows in the frame’s order, with the series as ingest exports them', () => {
    const model = faultEffect({
      faults: faults({ malformed: { percent: 3, kinds: ['range', 'json'] } }),
      effect: effect(BASELINE),
      metrics: feed(NOW),
    });
    expect(model.rows.map((r) => r.metric)).toEqual([
      'telemetry_sequence_gaps_total',
      'telemetry_rejections_total{reason="range"}',
      'telemetry_rejections_total{reason="json"}',
      'telemetry_messages_total',
      'telemetry_readings_total{result="stored"}',
      'telemetry_readings_total{result="duplicate"}',
    ]);
  });

  it('shows a reason that is among the kinds on even at 0, and one that moved even if it is not', () => {
    const model = faultEffect({
      faults: faults({ malformed: { percent: 3, kinds: ['range', 'seq'] } }),
      effect: effect(BASELINE),
      metrics: feed([...NOW, rejected('future', 5)]),
    });
    const reasons = model.rows.filter((r) => r.id.startsWith('rejections:')).map((r) => r.id);
    // json did not move (4 → 4) and is not on: left out. seq is on: shown at 0. future appeared after the baseline.
    expect(reasons).toEqual(['rejections:range', 'rejections:future', 'rejections:seq']);
    expect(row(model, 'rejections:seq')?.delta).toBe(0);
    expect(row(model, 'rejections:future')?.delta).toBe(5);
  });

  it('sorts the reasons by change, biggest first, then by name', () => {
    const model = faultEffect({
      faults: faults(),
      effect: effect([rejected('a', 0), rejected('b', 0), rejected('c', 0)]),
      metrics: feed([rejected('a', 2), rejected('b', 9), rejected('c', 2)]),
    });
    expect(model.rows.filter((r) => r.id.startsWith('rejections:')).map((r) => r.id)).toEqual([
      'rejections:b',
      'rejections:a',
      'rejections:c',
    ]);
  });

  it('has one row for rejections as a whole when no reason is shown', () => {
    const model = faultEffect({
      faults: faults(),
      effect: effect(BASELINE),
      metrics: feed(BASELINE),
    });
    expect(row(model, 'rejections')?.metric).toBe('telemetry_rejections_total');
    expect(row(model, 'rejections')?.delta).toBe(0);
    expect(model.rows.some((r) => r.id.startsWith('rejections:'))).toBe(false);
  });

  it('counts a series that ingest has not exported yet as 0', () => {
    const model = faultEffect({
      faults: faults({ drop: { percent: 5 } }),
      effect: effect([gaps(0)]),
      metrics: feed([gaps(7), readings('stored', 30)]),
    });
    expect(row(model, 'readings')?.delta).toBe(30);
    expect(row(model, 'messages')?.delta).toBe(0);
  });

  it('shows no figures when there is no baseline, and says why', () => {
    const model = faultEffect({
      faults: faults({ drop: { percent: 5 } }),
      effect: effect(null),
      metrics: feed(NOW),
    });
    expect(model.status).toBe('no-baseline');
    expect(model.rows.every((r) => r.delta === null)).toBe(true);
    expect(model.notes.join(' ')).toMatch(/nothing to subtract/);
  });

  it('shows no figure for a counter that went down, and says ingest started again', () => {
    const model = faultEffect({
      faults: faults(),
      effect: effect(BASELINE),
      metrics: feed([gaps(1), messages('accepted', 5), readings('stored', 10)]),
    });
    expect(row(model, 'gaps')).toMatchObject({ delta: null, restarted: true });
    expect(row(model, 'messages')).toMatchObject({ delta: null, restarted: true });
    expect(model.notes.join(' ')).toMatch(/ingest started again/);
  });

  it('says so when ingest is not being read now, and shows nothing when it never was', () => {
    const stale = faultEffect({
      faults: faults(),
      effect: effect(BASELINE),
      metrics: feed(NOW, { stale: true }),
    });
    expect(row(stale, 'gaps')?.delta).toBe(25);
    expect(stale.notes.join(' ')).toMatch(/not being read now/);

    const never = faultEffect({
      faults: faults(),
      effect: effect(BASELINE),
      metrics: feed([], { stale: true, lastOkAt: null }),
    });
    expect(never.rows.every((r) => r.delta === null)).toBe(true);
    expect(never.notes.join(' ')).toMatch(/not being read now/);
  });

  it('says what can move each counter now, from the faults that are on', () => {
    const idle = faultEffect({ faults: faults(), effect: effect(BASELINE), metrics: feed(NOW) });
    expect(row(idle, 'gaps')?.detail).toBe('messages ingest confirmed missing');
    expect(row(idle, 'messages')?.detail).toBe('accepted and rejected');

    const busy = faultEffect({
      faults: faults({
        drop: { percent: 5 },
        duplicate: { percent: 2 },
        malformed: { percent: 3, kinds: ['range'] },
        linkLoss: { since: 'x', forS: null },
      }),
      effect: effect(BASELINE),
      // json is not among the kinds on, but it moved (4 → 9), so it has a row.
      metrics: feed([...NOW.filter((s) => s.labels.reason !== 'json'), rejected('json', 9)]),
    });
    expect(row(busy, 'gaps')?.detail).toBe(
      'from Drop, Malformed and Link loss, confirmed after ingest’s grace period',
    );
    expect(row(busy, 'messages')?.detail).toBe('including duplicates');
    expect(row(busy, 'rejections:range')?.detail).toBe('from Malformed payloads');
    expect(row(busy, 'readings')?.detail).toMatch(/per metric/);
    expect(row(busy, 'rejections:json')?.detail).toBe('rejected by ingest');
  });

  it('reminds of the grace period only while a fault that makes gaps is on', () => {
    const note = /grace period/;
    const with_ = (changes: Partial<FaultsSnapshot>) =>
      faultEffect({
        faults: faults(changes),
        effect: effect(BASELINE),
        metrics: feed(NOW),
      }).notes.join(' ');
    expect(with_({ drop: { percent: 5 } })).toMatch(note);
    expect(with_({ malformed: { percent: 3, kinds: ['range'] } })).toMatch(note);
    expect(with_({ linkLoss: { since: 'x', forS: null } })).toMatch(note);
    expect(with_({ delay: { delayMs: 100, jitterMs: 0 }, reorder: { window: 3 } })).not.toMatch(
      note,
    );
    expect(with_({})).not.toMatch(note);
  });

  it('keeps the session after every fault is off', () => {
    const model = faultEffect({ faults: off, effect: effect(BASELINE), metrics: feed(NOW) });
    expect(model.status).toBe('ready');
    expect(row(model, 'gaps')?.delta).toBe(25);
  });
});

describe('deltaText', () => {
  it('writes a change with its sign and thousands, and a dash for a figure that cannot be told', () => {
    expect(deltaText({ delta: 25 })).toBe('+25');
    expect(deltaText({ delta: 0 })).toBe('+0');
    expect(deltaText({ delta: 12345 })).toBe('+12,345');
    expect(deltaText({ delta: null })).toBe('—');
  });
});

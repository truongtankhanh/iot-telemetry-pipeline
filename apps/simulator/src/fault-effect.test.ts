import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FAULT_COUNTERS, FaultEffect } from './fault-effect.ts';
import { FORWARDED_METRICS, type Sample } from './prometheus-text.ts';

const feed = (
  samples: Sample[],
  overrides: { stale?: boolean; lastOkAt?: string | null } = {},
) => ({
  samples,
  lastOkAt: overrides.lastOkAt === undefined ? '2026-10-01T05:00:01.000Z' : overrides.lastOkAt,
  stale: overrides.stale ?? false,
});

const gaps = (value: number): Sample => ({
  name: 'telemetry_sequence_gaps_total',
  labels: {},
  value,
});
const rejected = (reason: string, value: number): Sample => ({
  name: 'telemetry_rejections_total',
  labels: { reason },
  value,
});

function setup() {
  let nowMs = Date.parse('2026-10-22T09:00:00Z');
  const effect = new FaultEffect({ now: () => nowMs });
  return {
    effect,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe('FaultEffect', () => {
  it('has no session until a fault is switched on', () => {
    assert.equal(setup().effect.view(), null);
  });

  it('keeps the time and the counters of the moment it began', () => {
    const { effect } = setup();
    effect.ensureStarted(feed([gaps(3), rejected('range', 2)]));
    assert.deepEqual(effect.view(), {
      since: '2026-10-22T09:00:00.000Z',
      baseline: [gaps(3), rejected('range', 2)],
    });
  });

  it('a second fault keeps the first one’s baseline', () => {
    const { effect, advance } = setup();
    effect.ensureStarted(feed([gaps(3)]));
    advance(60_000);
    effect.ensureStarted(feed([gaps(40)]));
    assert.deepEqual(effect.view(), { since: '2026-10-22T09:00:00.000Z', baseline: [gaps(3)] });
  });

  it('restart replaces both, as the Reset counters button does', () => {
    const { effect, advance } = setup();
    effect.ensureStarted(feed([gaps(3)]));
    advance(60_000);
    effect.restart(feed([gaps(40)]));
    assert.deepEqual(effect.view(), { since: '2026-10-22T09:01:00.000Z', baseline: [gaps(40)] });
  });

  it('restart with no session begins one', () => {
    const { effect } = setup();
    effect.restart(feed([gaps(1)]));
    assert.notEqual(effect.view(), null);
  });

  it('without a usable read of ingest the session has a time and no baseline', () => {
    for (const unusable of [
      feed([gaps(3)], { stale: true }),
      feed([gaps(3)], { lastOkAt: null }),
      feed([], { stale: true, lastOkAt: null }),
    ]) {
      const { effect } = setup();
      effect.ensureStarted(unusable);
      assert.deepEqual(effect.view(), { since: '2026-10-22T09:00:00.000Z', baseline: null });
    }
  });

  it('keeps only the four counters of the panel', () => {
    const { effect } = setup();
    effect.ensureStarted(
      feed([
        gaps(1),
        { name: 'telemetry_messages_total', labels: { result: 'accepted' }, value: 10 },
        { name: 'telemetry_readings_total', labels: { result: 'stored' }, value: 20 },
        { name: 'alerts_transitions_total', labels: { transition: 'opened' }, value: 5 },
        { name: 'telemetry_ingest_lag_seconds_sum', labels: {}, value: 9 },
      ]),
    );
    assert.deepEqual(
      effect.view()?.baseline?.map((sample) => sample.name),
      ['telemetry_sequence_gaps_total', 'telemetry_messages_total', 'telemetry_readings_total'],
    );
  });

  it('reads only series the poller forwards, so a baseline can never miss one it needs', () => {
    for (const name of FAULT_COUNTERS) assert.ok(FORWARDED_METRICS.includes(name), name);
    assert.deepEqual(
      [...FAULT_COUNTERS],
      [
        'telemetry_messages_total',
        'telemetry_rejections_total',
        'telemetry_readings_total',
        'telemetry_sequence_gaps_total',
      ],
    );
  });

  it('gives a copy of the session, not the object it keeps', () => {
    const { effect } = setup();
    effect.ensureStarted(feed([gaps(3)]));
    const view = effect.view();
    assert.ok(view);
    view.since = 'tampered';
    assert.equal(effect.view()?.since, '2026-10-22T09:00:00.000Z');
  });
});

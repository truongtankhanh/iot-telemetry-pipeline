import { describe, expect, it } from 'vitest';
import type { Anomaly } from '../api/types';
import {
  addToDraft,
  draftAnomalies,
  draftLength,
  draftOverlap,
  draftSummary,
  EMPTY_DRAFT,
  removeFromDraft,
} from './labDraft';

const anomaly = (change: Partial<Anomaly> = {}): Anomaly => ({
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 20,
  duration: 60,
  ...change,
});

const ids = () => {
  let n = 0;
  return () => `e${++n}`;
};

describe('addToDraft', () => {
  it('adds one entry per anomaly, with a key of its own, and leaves the draft it was given alone', () => {
    const first = addToDraft(
      EMPTY_DRAFT,
      [anomaly(), anomaly({ deviceId: 'dc-env-02', startAt: 22 })],
      ids(),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.draft.map((e) => [e.id, e.anomaly.deviceId])).toEqual([
      ['e1', 'dc-env-01'],
      ['e2', 'dc-env-02'],
    ]);
    expect(EMPTY_DRAFT).toEqual([]);
  });

  it('copies the anomalies, so changing the form afterwards does not change the draft', () => {
    const source = anomaly();
    const result = addToDraft(EMPTY_DRAFT, [source], ids());
    source.value = 99;
    expect(result.ok && result.draft[0]?.anomaly.value).toBe(29.2);
  });

  it('refuses a fault that plays at once with one in the draft, and says which', () => {
    const base = addToDraft(EMPTY_DRAFT, [anomaly()], ids());
    if (!base.ok) throw new Error('setup');
    const clash = addToDraft(base.draft, [anomaly({ startAt: 50, duration: 10 })], ids());
    expect(clash).toEqual({
      ok: false,
      reason: 'dc-env-01 already has a fault on temperature_c in the timeline from 20 s to 80 s',
    });
  });

  it('accepts windows that only touch, and the same window on another device or metric', () => {
    const base = addToDraft(EMPTY_DRAFT, [anomaly()], ids());
    if (!base.ok) throw new Error('setup');
    for (const other of [
      anomaly({ startAt: 80 }),
      anomaly({ metric: 'humidity_pct' }),
      anomaly({ deviceId: 'dc-env-02' }),
    ]) {
      expect(addToDraft(base.draft, [other], ids()).ok).toBe(true);
    }
  });

  it('refuses two of the new anomalies that overlap each other', () => {
    const result = addToDraft(EMPTY_DRAFT, [anomaly(), anomaly({ startAt: 30 })], ids());
    expect(result.ok).toBe(false);
  });

  it('refuses to add nothing', () => {
    expect(addToDraft(EMPTY_DRAFT, [], ids())).toEqual({
      ok: false,
      reason: 'There is nothing to add',
    });
  });
});

describe('draftOverlap', () => {
  it('is null for no overlap', () => {
    expect(draftOverlap([anomaly()], [anomaly({ deviceId: 'dc-env-02' })])).toBeNull();
    expect(draftOverlap([], [])).toBeNull();
  });
});

describe('the rest of the draft', () => {
  const draft = (() => {
    const result = addToDraft(
      EMPTY_DRAFT,
      [anomaly(), anomaly({ deviceId: 'dc-env-02', startAt: 30, duration: 90 })],
      ids(),
    );
    if (!result.ok) throw new Error('setup');
    return result.draft;
  })();

  it('removes an entry by its key', () => {
    expect(removeFromDraft(draft, 'e1').map((e) => e.id)).toEqual(['e2']);
    expect(removeFromDraft(draft, 'nope')).toHaveLength(2);
  });

  it('gives the anomalies and the length: the end of the last one', () => {
    expect(draftAnomalies(draft).map((a) => a.deviceId)).toEqual(['dc-env-01', 'dc-env-02']);
    expect(draftLength(draft)).toBe(120);
    expect(draftLength(EMPTY_DRAFT)).toBe(0);
  });

  it('summarises it as the dock does', () => {
    expect(draftSummary(EMPTY_DRAFT)).toBe('Nothing added yet');
    expect(draftSummary(draft)).toBe('2 anomalies · starts spread over 10 s');
    const one = addToDraft(EMPTY_DRAFT, [anomaly()], ids());
    expect(one.ok && draftSummary(one.draft)).toBe('1 anomaly · 80 s');
  });
});

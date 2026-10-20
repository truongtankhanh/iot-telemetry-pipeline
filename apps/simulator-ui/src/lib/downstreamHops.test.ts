import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { ObservedAlert, StateView } from '../api/types';
import { advancedHops, type HopSnapshot, snapshotOf } from './downstreamHops';

const alert = (id: string, extra: Partial<ObservedAlert> = {}): ObservedAlert => ({
  ...(structuredClone(fixture.alerts.alerts[0]) as ObservedAlert),
  id,
  ...extra,
});

const snap = (
  readings: number | null,
  alerts: Record<string, { delivery: string | null; preexisting?: boolean }> = {},
): HopSnapshot => ({
  readings,
  alerts: new Map(
    Object.entries(alerts).map(([id, a]) => [
      id,
      { delivery: a.delivery, preexisting: a.preexisting ?? false },
    ]),
  ),
});

describe('advancedHops', () => {
  it('is silent on the first read: there is nothing to compare with', () => {
    expect(advancedHops(null, snap(100, { '1': { delivery: 'delivered' } }))).toEqual([]);
  });

  it('moves the readings along when the stored counter grew', () => {
    expect(advancedHops(snap(100), snap(130))).toEqual([
      'broker>ingest',
      'ingest>rules',
      'ingest>database',
    ]);
  });

  it('is silent when nothing was stored, when the counter fell, or when it is not known', () => {
    expect(advancedHops(snap(100), snap(100))).toEqual([]);
    expect(advancedHops(snap(500), snap(3))).toEqual([]);
    expect(advancedHops(snap(null), snap(10))).toEqual([]);
    expect(advancedHops(snap(10), snap(null))).toEqual([]);
  });

  it('moves a new alert from the rules to the alert and the outbox', () => {
    expect(advancedHops(snap(1), snap(1, { '7': { delivery: 'pending' } }))).toEqual([
      'rules>alert',
      'alert>outbox',
    ]);
  });

  it('moves a delivery to the command center when it first becomes delivered', () => {
    const before = snap(1, { '7': { delivery: 'pending' } });
    expect(advancedHops(before, snap(1, { '7': { delivery: 'delivered' } }))).toEqual([
      'outbox>commandCenter',
    ]);
  });

  it('does it once: an alert that stays delivered moves nothing', () => {
    const delivered = snap(1, { '7': { delivery: 'delivered' } });
    expect(advancedHops(delivered, delivered)).toEqual([]);
  });

  it('moves everything for a new alert that is already delivered when first seen', () => {
    expect(advancedHops(snap(1), snap(1, { '7': { delivery: 'delivered' } }))).toEqual([
      'rules>alert',
      'alert>outbox',
      'outbox>commandCenter',
    ]);
  });

  it('does not count an alert that was already there when Studio started', () => {
    const next = snap(1, { '7': { delivery: 'delivered', preexisting: true } });
    expect(advancedHops(snap(1), next)).toEqual([]);
  });

  it('does not move the command center for a failed or skipped delivery', () => {
    expect(advancedHops(snap(1), snap(1, { '7': { delivery: 'failed' } }))).toEqual([
      'rules>alert',
      'alert>outbox',
    ]);
    expect(advancedHops(snap(1), snap(1, { '7': { delivery: 'skipped' } }))).toEqual([
      'rules>alert',
      'alert>outbox',
    ]);
  });

  it('lists each hop once, however many alerts moved', () => {
    const next = snap(1, { '7': { delivery: 'delivered' }, '8': { delivery: 'delivered' } });
    expect(advancedHops(snap(1), next)).toEqual([
      'rules>alert',
      'alert>outbox',
      'outbox>commandCenter',
    ]);
  });
});

describe('snapshotOf', () => {
  const view = (change: (v: StateView) => void = () => {}): StateView => {
    const copy = structuredClone(fixture);
    change(copy);
    return copy;
  };

  it('takes the stored counter and each alert with its delivery', () => {
    const snapshot = snapshotOf(
      view((v) => {
        v.metrics.samples = [
          { name: 'telemetry_readings_total', labels: { result: 'stored' }, value: 12 },
        ];
        v.alerts.alerts = [alert('7', { deliveryStatus: 'pending', preexisting: true })];
      }),
    );
    expect(snapshot.readings).toBe(12);
    expect(snapshot.alerts.get('7')).toEqual({ delivery: 'pending', preexisting: true });
  });

  it('has no readings when the metrics are stale', () => {
    expect(snapshotOf(view((v) => (v.metrics.stale = true))).readings).toBeNull();
  });
});

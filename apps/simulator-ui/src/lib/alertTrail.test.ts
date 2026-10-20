import { describe, expect, it } from 'vitest';
import type { PagedAlert, RuleInfo } from '../api/types';
import type { Sample } from '../state/history';
import { alertTrail, type TrailStep } from './alertTrail';

const OPENED = Date.parse('2026-10-20T08:00:26.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const rule: RuleInfo = {
  id: 'server-room-hot',
  kind: 'server_room',
  metric: 'temperature_c',
  direction: 'above',
  raise: 27,
  clear: 25.5,
  for: 3,
  severity: 'high',
  title: 'Server room temperature high',
};

const alert = (overrides: Partial<PagedAlert> = {}): PagedAlert => ({
  id: '7',
  deviceId: 'dc-env-01',
  ruleId: 'server-room-hot',
  metric: 'temperature_c',
  severity: 'high',
  title: 'Server room temperature high',
  status: 'open',
  openedAt: iso(OPENED),
  openedValue: 29.3,
  clearedAt: null,
  clearedValue: null,
  externalRef: null,
  deliveryStatus: 'pending',
  deliveryAttempts: 0,
  deliveryError: null,
  preexisting: false,
  observed: {
    openedAt: iso(OPENED + 1000),
    clearedAt: null,
    delivered: { opened: null, cleared: null },
    incident: null,
  },
  cause: null,
  ...overrides,
});

/** An alert whose opening was delivered, as Studio saw it 2 s after it opened. */
const delivered = (overrides: Partial<PagedAlert> = {}) =>
  alert({
    deliveryStatus: 'delivered',
    deliveryAttempts: 1,
    externalRef: 'c3a1f0d2-5b7e',
    observed: {
      openedAt: iso(OPENED + 1000),
      clearedAt: null,
      delivered: { opened: iso(OPENED + 2000), cleared: null },
      incident: iso(OPENED + 2000),
    },
    ...overrides,
  });

/** 25.1 then three breaching readings, the last at the moment the alert opened. */
const history: Sample[] = [25.1, 29.2, 29.4, 29.3].map((v, i, all) => ({
  t: OPENED - (all.length - 1 - i) * 2000,
  v,
}));

const ids = (steps: TrailStep[]) => steps.map((step) => step.id);
const step = (steps: TrailStep[], id: TrailStep['id']) => steps.find((s) => s.id === id);
const run = (a: PagedAlert, series: Sample[] = history) => alertTrail({ alert: a, rule, series });

describe('the trail of a delivered alert (frame 13)', () => {
  const { steps, notes } = run(delivered());

  it('goes from the first breaching reading to the incident, in order', () => {
    expect(ids(steps)).toEqual(['first-breach', 'raised', 'opened', 'outbox', 'incident']);
    expect(steps.every((s) => s.tone !== 'bad')).toBe(true);
  });

  it('gives the first breaching reading as a recorded reading, and the rule and alert as ingest’s', () => {
    expect(step(steps, 'first-breach')).toMatchObject({
      detail: '29.2 °C, above the raise threshold',
      time: OPENED - 4000,
      provenance: 'recorded reading',
    });
    expect(step(steps, 'raised')).toMatchObject({
      detail: 'server-room-hot · 3 of 3',
      time: OPENED,
      provenance: 'ingest',
    });
    expect(step(steps, 'opened')).toMatchObject({ time: OPENED, provenance: 'ingest' });
  });

  it('gives the delivery and the incident as observed, with the incident id in full', () => {
    expect(step(steps, 'outbox')).toMatchObject({
      title: 'Outbox delivered',
      detail: '1 attempt · first seen delivered by Studio',
      tone: 'ok',
      time: OPENED + 2000,
      provenance: 'observed',
    });
    expect(step(steps, 'incident')).toMatchObject({
      detail: 'c3a1f0d2-5b7e',
      mono: true,
      provenance: 'observed',
    });
  });

  it('says what the times mean', () => {
    expect(notes.at(-1)).toMatch(/first saw the state change.*1 s polling.*no delivery timestamp/);
    expect(notes.join(' ')).not.toMatch(/latest outbox event/);
  });
});

describe('a delivery that did not happen', () => {
  it('pending: a warning, no time, and no incident', () => {
    const { steps } = run(alert({ deliveryStatus: 'pending', deliveryAttempts: 2 }));
    expect(step(steps, 'outbox')).toMatchObject({
      title: 'Outbox pending',
      detail: '2 attempts · not delivered yet',
      tone: 'warn',
      time: null,
      provenance: null,
    });
    expect(ids(steps)).not.toContain('incident');
  });

  it('failed: bad, with the attempts and ingest’s error as text, and no incident', () => {
    const { steps } = run(
      alert({
        deliveryStatus: 'failed',
        deliveryAttempts: 5,
        deliveryError: 'HTTP 502 from the command center',
      }),
    );
    expect(step(steps, 'outbox')).toMatchObject({
      title: 'Outbox delivery failed',
      detail: '5 attempts · HTTP 502 from the command center',
      tone: 'bad',
    });
    expect(ids(steps)).not.toContain('incident');
  });

  it('failed without a reason says so instead of leaving a blank', () => {
    const { steps } = run(
      alert({ deliveryStatus: 'failed', deliveryAttempts: 1, deliveryError: null }),
    );
    expect(step(steps, 'outbox')?.detail).toBe('1 attempt · no reason given');
  });

  it('skipped: neutral, naming the setting, and no incident', () => {
    const { steps } = run(alert({ deliveryStatus: 'skipped', deliveryAttempts: 0 }));
    expect(step(steps, 'outbox')).toMatchObject({ title: 'Delivery skipped', tone: 'neutral' });
    expect(step(steps, 'outbox')?.detail).toMatch(/OCC_API_URL unset on ingest/);
    expect(ids(steps)).not.toContain('incident');
  });

  it('unknown or missing: never drawn as delivered', () => {
    for (const deliveryStatus of [null, 'quarantined']) {
      const { steps } = run(alert({ deliveryStatus }));
      expect(step(steps, 'outbox')).toMatchObject({ title: 'Delivery unknown', tone: 'neutral' });
    }
  });

  it('delivered before Studio saw it: delivered, without a time', () => {
    const { steps } = run(
      delivered({
        preexisting: true,
        observed: {
          openedAt: null,
          clearedAt: null,
          delivered: { opened: null, cleared: null },
          incident: null,
        },
      }),
    );
    expect(step(steps, 'outbox')).toMatchObject({
      detail: '1 attempt · delivered before Studio saw it',
      time: null,
      provenance: null,
    });
    expect(step(steps, 'incident')).toMatchObject({ time: null, provenance: null });
  });
});

describe('the first breaching reading', () => {
  it('is left out, with a note, when Studio holds too few readings', () => {
    const { steps, notes } = run(delivered(), history.slice(2));
    expect(ids(steps)).not.toContain('first-breach');
    expect(notes[0]).toMatch(/first breaching reading is not shown/);
  });

  it('is left out when the run starts at the oldest reading held, whose true start may be older', () => {
    const { steps } = run(delivered(), history.slice(1));
    expect(ids(steps)).not.toContain('first-breach');
  });

  it('is left out for an alert Studio did not see open, and when the rule is not known', () => {
    expect(ids(run(delivered({ preexisting: true })).steps)).not.toContain('first-breach');
    const { steps } = alertTrail({ alert: delivered(), rule: null, series: history });
    expect(ids(steps)).not.toContain('first-breach');
    expect(step(steps, 'raised')?.detail).toBe('server-room-hot');
  });
});

describe('a cleared alert', () => {
  const cleared = (overrides: Partial<PagedAlert> = {}) =>
    delivered({
      status: 'cleared',
      clearedAt: iso(OPENED + 64000),
      clearedValue: 25.1,
      deliveryStatus: 'delivered',
      observed: {
        openedAt: iso(OPENED + 1000),
        clearedAt: iso(OPENED + 65000),
        delivered: { opened: iso(OPENED + 2000), cleared: iso(OPENED + 66000) },
        incident: iso(OPENED + 2000),
      },
      ...overrides,
    });

  it('adds the clearing and its delivery after the incident, and says what the list’s chip means', () => {
    const { steps, notes } = run(cleared());
    expect(ids(steps)).toEqual([
      'first-breach',
      'raised',
      'opened',
      'outbox',
      'incident',
      'cleared',
      'clear-outbox',
    ]);
    expect(step(steps, 'cleared')).toMatchObject({
      detail: 'back to 25.1 °C',
      time: OPENED + 64000,
      provenance: 'ingest',
    });
    expect(step(steps, 'clear-outbox')).toMatchObject({
      title: 'Clear delivered',
      time: OPENED + 66000,
      provenance: 'observed',
    });
    expect(notes.join(' ')).toMatch(/latest outbox event.*clearing/);
  });

  it('takes the opening’s delivery from what Studio saw, since ingest now reports the clearing’s', () => {
    expect(step(run(cleared()).steps, 'outbox')).toMatchObject({
      title: 'Outbox delivered',
      time: OPENED + 2000,
    });
  });

  it('does not claim an opening delivery it knows nothing about', () => {
    const { steps } = run(
      cleared({
        externalRef: null,
        observed: {
          openedAt: null,
          clearedAt: null,
          delivered: { opened: null, cleared: null },
          incident: null,
        },
      }),
    );
    expect(step(steps, 'outbox')).toMatchObject({
      title: 'Opening delivery not known',
      tone: 'neutral',
    });
  });

  it('knows the opening was delivered from the incident id even when it did not see it', () => {
    const { steps } = run(
      cleared({
        observed: {
          openedAt: null,
          clearedAt: null,
          delivered: { opened: null, cleared: null },
          incident: null,
        },
      }),
    );
    expect(step(steps, 'outbox')).toMatchObject({ title: 'Outbox delivered', time: null });
  });

  it('shows a clearing that failed to deliver', () => {
    const { steps } = run(
      cleared({ deliveryStatus: 'failed', deliveryAttempts: 3, deliveryError: 'HTTP 500' }),
    );
    expect(step(steps, 'clear-outbox')).toMatchObject({
      title: 'Clear delivery failed',
      detail: '3 attempts · HTTP 500',
      tone: 'bad',
    });
  });
});

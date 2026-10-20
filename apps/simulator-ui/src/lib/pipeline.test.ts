import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { StateView } from '../api/types';
import type { Sample } from '../state/history';
import type { LinkState } from '../state/store';
import { buildFleetRows } from './fleetRows';
import type { IngestRates } from './ingestRates';
import { derivePipeline, STAGE_ORDER, type StageId, type StageNode } from './pipeline';
import { formatClockTime } from './time';

const NOW = Date.parse('2026-10-20T09:14:32.000Z');
const NO_RATES: IngestRates = { storedPerSecond: null, lagSeconds: null };

interface Options {
  series?: Record<string, Sample[]>;
  link?: LinkState;
  lastAlertSink?: string | null;
  rates?: IngestRates;
  publishRate?: number;
}

function pipeline(change: (view: StateView) => void = () => {}, options: Options = {}) {
  const view = structuredClone(fixture);
  change(view);
  const seriesOf = (deviceId: string, metric: string) =>
    options.series?.[`${deviceId}/${metric}`] ?? [];
  const rows = buildFleetRows({ view, now: NOW, seriesOf, lastSeenOf: () => null });
  const nodes = derivePipeline({
    view,
    link: options.link ?? 'live',
    lastAlertSink: options.lastAlertSink ?? null,
    rows,
    seriesOf,
    rates: options.rates ?? NO_RATES,
    publishRate: options.publishRate ?? 2,
  });
  return Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<StageId, StageNode>;
}

const readings = (...values: number[]): Sample[] =>
  values.map((v, i) => ({ t: NOW - (values.length - i) * 2000, v }));

const quiet = (view: StateView) => {
  view.alerts.alerts = [];
};

const withDelivery =
  (deliveryStatus: string | null, extra: Partial<StateView['alerts']['alerts'][number]> = {}) =>
  (view: StateView) => {
    const alert = view.alerts.alerts[0];
    if (alert === undefined) throw new Error('the fixture has an alert');
    Object.assign(alert, { deliveryStatus, ...extra });
  };

describe('the seven stages', () => {
  it('are always the same seven, in the order a reading passes through them', () => {
    const nodes = derivePipeline({
      view: structuredClone(fixture),
      link: 'live',
      lastAlertSink: null,
      rows: [],
      seriesOf: () => [],
      rates: NO_RATES,
      publishRate: 0,
    });
    expect(nodes.map((node) => node.id)).toEqual([...STAGE_ORDER]);
    expect(nodes.every((node) => node.word.length > 0)).toBe(true);
  });
});

describe('when everything answers', () => {
  it('draws a healthy broker with its port and the rate', () => {
    const { broker } = pipeline(quiet, { publishRate: 7.5 });
    expect(broker).toMatchObject({
      state: 'healthy',
      word: 'Connected',
      headline: ':1883',
      detail: '7.5 msg/s',
      dimmed: false,
    });
  });

  it('shows ingest lag and the stored rate only when they were measured', () => {
    const measured = pipeline(quiet, { rates: { storedPerSecond: 15, lagSeconds: 0.04 } });
    expect(measured.ingest).toMatchObject({
      state: 'healthy',
      word: 'Ready',
      headline: '0.04 s lag',
      detail: '15.0 readings/s',
    });
    expect(measured.database).toMatchObject({
      state: 'healthy',
      headline: 'up',
      detail: '15.0 stored/s',
    });

    const unmeasured = pipeline(quiet);
    expect(unmeasured.ingest).toMatchObject({ headline: 'ready', detail: null });
    expect(unmeasured.database.detail).toBeNull();
  });

  it('has no figure that was not measured: no PUBACK time, no buffer size', () => {
    const nodes = Object.values(
      pipeline(quiet, { rates: { storedPerSecond: 3, lagSeconds: 0.2 } }),
    );
    const text = nodes.map((node) => `${node.headline} ${node.detail}`).join(' ');
    expect(text).not.toMatch(/\bms\b/);
    expect(text).not.toMatch(/buffered/);
  });

  it('is quiet, with nothing to deliver, when there are no alerts', () => {
    const nodes = pipeline(quiet);
    expect(nodes.alert).toMatchObject({
      state: 'healthy',
      word: 'Quiet',
      headline: 'no open alert',
    });
    expect(nodes.outbox).toMatchObject({ state: 'healthy', word: 'Idle' });
    expect(nodes.commandCenter).toMatchObject({ state: 'healthy', word: 'Ready' });
    expect(nodes.rules).toMatchObject({
      state: 'healthy',
      headline: '4 rules',
      detail: 'none beyond a raise line',
    });
  });
});

describe('the alert chain', () => {
  it('shows an open alert, its delivery and the incident', () => {
    const nodes = pipeline();
    expect(nodes.alert).toMatchObject({ state: 'anomaly', word: 'Open', headline: '#7 · high' });
    expect(nodes.alert.detail).toBe(
      `opened ${formatClockTime(Date.parse('2026-10-20T09:14:35.000Z'))}`,
    );
    expect(nodes.outbox).toMatchObject({
      state: 'healthy',
      word: 'Delivered',
      detail: '1 attempt',
    });
    expect(nodes.commandCenter).toMatchObject({
      state: 'healthy',
      word: 'Incident',
      headline: 'incident c3a1…',
    });
  });

  it('says how many more alerts are open', () => {
    const nodes = pipeline((view) => {
      const first = view.alerts.alerts[0];
      if (first === undefined) throw new Error('the fixture has an alert');
      view.alerts.alerts.push({ ...first, id: '8' }, { ...first, id: '9', status: 'cleared' });
    });
    expect(nodes.alert.detail).toMatch(/\+1 more open$/);
  });

  it('waits for a pending delivery, with no incident yet', () => {
    const nodes = pipeline(withDelivery('pending', { externalRef: null, deliveryAttempts: 0 }));
    expect(nodes.outbox).toMatchObject({
      state: 'anomaly',
      word: 'Pending',
      headline: '#7 waiting',
    });
    expect(nodes.commandCenter).toMatchObject({
      state: 'healthy',
      word: 'Ready',
      headline: 'no incident yet',
    });
  });

  it('is down in the outbox and failing at the command center when a delivery failed', () => {
    const nodes = pipeline(
      withDelivery('failed', { externalRef: null, deliveryError: 'HTTP 502' }),
    );
    expect(nodes.outbox).toMatchObject({ state: 'down', word: 'Failed', detail: 'HTTP 502' });
    expect(nodes.commandCenter).toMatchObject({ state: 'down', word: 'Failing' });
  });

  it('counts a failure of an older alert, not only the newest', () => {
    const nodes = pipeline((view) => {
      const first = view.alerts.alerts[0];
      if (first === undefined) throw new Error('the fixture has an alert');
      view.alerts.alerts.push({ ...first, id: '6', deliveryStatus: 'failed', status: 'cleared' });
    });
    expect(nodes.outbox.state).toBe('down');
  });

  it('draws a skipped delivery grey', () => {
    const nodes = pipeline(withDelivery('skipped', { externalRef: null }));
    expect(nodes.outbox).toMatchObject({ state: 'stale', word: 'Skipped' });
  });

  it.each([null, 'retrying', 'DELIVERED'])(
    'never draws a delivery status it does not know (%s) healthy',
    (status) => {
      const nodes = pipeline(withDelivery(status, { externalRef: null }));
      expect(nodes.outbox).toMatchObject({ state: 'stale', word: 'Unknown' });
    },
  );

  it('says the command center is not configured, and the outbox has no sink, when ingest has none', () => {
    const nodes = pipeline((view) => {
      view.ingest.alertSink = 'none';
    });
    expect(nodes.commandCenter).toMatchObject({
      state: 'stale',
      word: 'Not configured',
      headline: 'not configured',
    });
    expect(nodes.outbox).toMatchObject({ state: 'stale', word: 'No sink' });
  });
});

describe('the rules', () => {
  it("count the readings in a row beyond the raise line, against the rule's `for`", () => {
    const series = { 'dc-env-01/temperature_c': readings(22.4, 29.2, 29.4, 29.3) };
    expect(pipeline(quiet, { series }).rules).toMatchObject({
      state: 'anomaly',
      headline: 'server-room-hot',
      detail: '3 of 3 readings · dc-env-01',
    });
  });

  it('show progress before the alert opens', () => {
    const series = { 'dc-env-01/temperature_c': readings(22.4, 22.5, 29.2) };
    expect(pipeline(quiet, { series }).rules.detail).toBe('1 of 3 readings · dc-env-01');
  });

  it('never count past `for`', () => {
    const series = { 'dc-env-01/temperature_c': readings(29, 29, 29, 29, 29, 29) };
    expect(pipeline(quiet, { series }).rules.detail).toBe('3 of 3 readings · dc-env-01');
  });

  it('name the device closest to opening an alert', () => {
    const series = {
      'dc-env-01/temperature_c': readings(22.4, 29.2),
      'dc-env-02/temperature_c': readings(29.2, 29.4, 29.1),
    };
    expect(pipeline(quiet, { series }).rules.detail).toBe('3 of 3 readings · dc-env-02');
  });

  it('start again when a reading comes back within the line', () => {
    const series = { 'dc-env-01/temperature_c': readings(29.2, 29.4, 22.4) };
    expect(pipeline(quiet, { series }).rules.state).toBe('healthy');
  });

  it('ignore a paused device: it sends nothing, so its last readings are not a rule being met now', () => {
    const series = { 'hub-power-01/power_kw': readings(190, 190, 190) };
    expect(pipeline(quiet, { series }).rules.state).toBe('healthy');
  });

  it('say so when the rules are not available', () => {
    const nodes = pipeline((view) => {
      view.rules = { available: false, reason: 'no rules file was given', items: [] };
    });
    expect(nodes.rules).toMatchObject({
      state: 'stale',
      word: 'Not available',
      detail: 'no rules file was given',
    });
  });
});

describe('when ingest is not ready', () => {
  it('draws ingest as an anomaly and the database down when that is the reason', () => {
    const nodes = pipeline((view) => {
      view.ingest.status = 'not-ready';
      view.ingest.database = 'down';
    });
    expect(nodes.ingest).toMatchObject({
      state: 'anomaly',
      word: 'Not ready',
      detail: 'database down',
    });
    expect(nodes.database).toMatchObject({ state: 'down', word: 'Down' });
    // it still answers, so what it says is current
    expect(nodes.alert.dimmed).toBe(false);
  });
});

describe('when the broker is disconnected', () => {
  it("draws the broker down with its URL and leaves ingest's own answer alone", () => {
    const nodes = pipeline((view) => {
      view.broker.connected = false;
    });
    expect(nodes.broker).toMatchObject({
      state: 'down',
      word: 'Disconnected',
      headline: 'disconnected',
      detail: 'mqtt://localhost:1883',
    });
    expect(nodes.ingest.state).toBe('healthy');
  });
});

describe('when ingest is unreachable', () => {
  const unreachable = (view: StateView) => {
    view.ingest = {
      ...view.ingest,
      status: 'unreachable',
      database: null,
      broker: null,
      alertSink: null,
      detail: 'ECONNREFUSED',
    };
  };
  const seen = Date.parse('2026-10-20T09:14:31.000Z');

  it('draws ingest down, dated by the last good answer', () => {
    const { ingest } = pipeline(unreachable);
    expect(ingest).toMatchObject({
      state: 'down',
      word: 'Unreachable',
      detail: `seen ${formatClockTime(seen)}`,
      asOf: seen,
      dimmed: false,
    });
  });

  it('draws every stage after it unknown, dated and dimmed, never a guess', () => {
    const nodes = pipeline(unreachable, { lastAlertSink: 'ops-command-center' });
    for (const id of ['database', 'rules', 'alert', 'outbox', 'commandCenter'] as const) {
      expect(nodes[id]).toMatchObject({
        state: 'stale',
        word: 'Unknown',
        headline: null,
        detail: `as of ${formatClockTime(seen)}`,
        asOf: seen,
        dimmed: true,
      });
    }
    expect(nodes.broker.dimmed).toBe(false);
  });

  it('keeps saying "not configured" from the last sink ingest reported, dimmed', () => {
    const nodes = pipeline(unreachable, { lastAlertSink: 'none' });
    expect(nodes.commandCenter).toMatchObject({
      state: 'stale',
      word: 'Not configured',
      dimmed: true,
      asOf: seen,
    });
    expect(nodes.outbox.word).toBe('Unknown');
  });

  it('has no date when Studio never had an answer', () => {
    const nodes = pipeline((view) => {
      unreachable(view);
      view.alerts.lastOkAt = null;
      view.metrics.lastOkAt = null;
    });
    expect(nodes.alert).toMatchObject({ word: 'Unknown', detail: null, asOf: null });
    expect(nodes.ingest.detail).toBeNull();
  });
});

describe('before ingest has answered', () => {
  it('says it is checking, with no date', () => {
    const nodes = pipeline((view) => {
      view.ingest.status = 'unknown';
    });
    expect(nodes.ingest).toMatchObject({ state: 'stale', word: 'Checking', asOf: null });
    expect(nodes.rules).toMatchObject({ word: 'Checking', detail: null });
  });
});

describe('when the link to the simulator is lost', () => {
  it('dims every stage: what is shown is the last answer', () => {
    const nodes = Object.values(pipeline(quiet, { link: 'lost' }));
    expect(nodes.every((node) => node.dimmed)).toBe(true);
  });
});

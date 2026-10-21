import { describe, expect, it } from 'vitest';
import { stateViewFixture } from '../api/fixtures/stateView';
import type { ObservedAlert, StateView } from '../api/types';
import type { DeviceStatusKind } from './deviceStatus';
import type { FleetRow } from './fleetQuery';
import type { IngestRates } from './ingestRates';
import { derivePipeline } from './pipeline';
import { ALERT_FEED_LIMIT, lagText, overviewKpis, type OverviewKpiInput } from './overviewKpis';

const RATES: IngestRates = { storedPerSecond: 3, lagSeconds: 0.04 };

/** The fixture's state on the wall clock, with an alert feed that can be replaced. */
function viewOf(change: (view: StateView) => void = () => {}): StateView {
  const view = structuredClone(stateViewFixture);
  view.engine.simulated = false;
  view.config.simulated = false;
  change(view);
  return view;
}

const alert = (overrides: Partial<ObservedAlert> = {}): ObservedAlert => ({
  ...structuredClone(stateViewFixture.alerts.alerts[0] as ObservedAlert),
  ...overrides,
});

const row = (id: string, kind: DeviceStatusKind): FleetRow =>
  ({
    device: { id, kind: 'server_room', zoneCode: 'BLD-DC', metrics: [] },
    name: id,
    code: id,
    status: { kind, node: 'healthy', word: kind, since: null, reason: null },
    readings: [],
    lastSeen: null,
  }) as FleetRow;

function kpis(view: StateView, extra: Partial<OverviewKpiInput> = {}) {
  return overviewKpis({
    view,
    rows: [],
    publishRate: 2,
    rates: RATES,
    lastAlertSink: 'ops-command-center',
    ...extra,
  });
}

describe('devices online', () => {
  it("is the engine's running devices over the registered ones, as the Fleet counts them", () => {
    const { devices } = kpis(viewOf());
    expect(devices).toMatchObject({ known: true, total: 6, online: 5, paused: 1, stopped: 0 });
    expect(devices.availability).toBe(83.3);
    expect(devices.tone).toBe('warn');
  });

  it('counts a device the engine does not list as stopped', () => {
    const view = viewOf((v) => {
      v.engine.devices = v.engine.devices.filter((d) => d.id !== 'dc-env-02');
    });
    expect(kpis(view).devices).toMatchObject({ online: 4, paused: 1, stopped: 1 });
    const fewer = viewOf((v) => {
      v.engine.devices = v.engine.devices.slice(0, 3);
    });
    expect(kpis(fewer).devices).toMatchObject({ online: 3, paused: 0, stopped: 3 });
  });

  it('is ok when every device runs, bad when none does, and has no availability with no device', () => {
    const all = viewOf((v) => {
      for (const d of v.engine.devices) d.state = 'running';
    });
    expect(kpis(all).devices).toMatchObject({ availability: 100, tone: 'ok' });
    const none = viewOf((v) => {
      for (const d of v.engine.devices) d.state = 'stopped';
    });
    expect(kpis(none).devices).toMatchObject({
      online: 0,
      stopped: 6,
      availability: 0,
      tone: 'bad',
    });
    const empty = viewOf((v) => {
      v.devices = [];
      v.engine.devices = [];
    });
    expect(kpis(empty).devices).toMatchObject({ total: 0, availability: null, tone: 'unknown' });
  });
});

describe('active alerts', () => {
  it('counts the open alerts of the feed by severity', () => {
    const view = viewOf((v) => {
      v.alerts.alerts = [
        alert({ id: '9', severity: 'critical' }),
        alert({ id: '8', severity: 'high' }),
        alert({ id: '7', severity: 'high' }),
        alert({ id: '6', severity: 'low', status: 'cleared' }),
        alert({ id: '5', severity: 'surprising' }),
      ];
    });
    const result = kpis(view).alerts;
    expect(result).toMatchObject({
      known: true,
      open: 4,
      bySeverity: { critical: 1, high: 2, medium: 0, low: 1 },
      tone: 'bad',
    });
  });

  it('is warn for an open alert that is not critical, and ok for none', () => {
    expect(kpis(viewOf()).alerts).toMatchObject({ known: true, open: 1, tone: 'warn' });
    const quiet = viewOf((v) => {
      v.alerts.alerts = [];
    });
    expect(kpis(quiet).alerts).toMatchObject({ known: true, open: 0, tone: 'ok' });
  });

  it('says when the feed is as long as the poll keeps, so an older open alert may be missing', () => {
    const full = viewOf((v) => {
      v.alerts.alerts = Array.from({ length: ALERT_FEED_LIMIT }, (_, i) =>
        alert({ id: String(i), status: 'cleared' }),
      );
    });
    expect(kpis(full).alerts).toMatchObject({ known: true, feedFull: true });
    expect(kpis(viewOf()).alerts).toMatchObject({ feedFull: false });
  });

  it('is unknown, not zero, when ingest does not answer or the feed is stale', () => {
    const down = viewOf((v) => {
      v.ingest.status = 'unreachable';
    });
    expect(kpis(down).alerts).toEqual({ known: false, reason: 'ingest does not answer' });
    const starting = viewOf((v) => {
      v.ingest.status = 'unknown';
    });
    expect(kpis(starting).alerts).toEqual({ known: false, reason: 'ingest has not answered yet' });
    const stale = viewOf((v) => {
      v.alerts.stale = true;
    });
    expect(kpis(stale).alerts).toEqual({ known: false, reason: 'the alerts could not be read' });
    const never = viewOf((v) => {
      v.alerts.lastOkAt = null;
    });
    expect(kpis(never).alerts.known).toBe(false);
  });
});

describe('message rate', () => {
  it("is the stream's rate, per second and per minute, with the sequence gaps ingest counted", () => {
    const { rate } = kpis(viewOf(), { publishRate: 2.04 });
    expect(rate).toMatchObject({ known: true, perSecond: 2.04, perMinute: 122, note: null });
    expect(rate.sequenceGaps).toBe(0);
  });

  it("does not know the gaps when ingest's metrics are stale or lack the counter", () => {
    const stale = viewOf((v) => {
      v.metrics.stale = true;
    });
    expect(kpis(stale).rate.sequenceGaps).toBeNull();
    const none = viewOf((v) => {
      v.metrics.samples = v.metrics.samples.filter(
        (s) => s.name !== 'telemetry_sequence_gaps_total',
      );
    });
    expect(kpis(none).rate.sequenceGaps).toBeNull();
  });

  it('explains a rate of zero on a stepped clock: it is not a fault', () => {
    const stepped = viewOf((v) => {
      v.engine.simulated = true;
    });
    expect(kpis(stepped, { publishRate: 0 }).rate.note).toMatch(
      /nothing is published between steps/,
    );
  });
});

describe('ingest lag', () => {
  it("is the lag of the last two reads, written as the Topology's Ingest stage writes it", () => {
    expect(kpis(viewOf()).lag).toMatchObject({ known: true, seconds: 0.04, text: '0.04' });
    expect(lagText(0.04)).toBe('0.04');
    expect(lagText(0.999)).toBe('1.00');
    expect(lagText(1.234)).toBe('1.2');
    expect(lagText(12)).toBe('12.0');
  });

  it("is the figure the Topology's Ingest stage shows, for any lag", () => {
    for (const lagSeconds of [0.04, 0.5, 0.999, 1, 1.234, 12]) {
      const rates = { storedPerSecond: 3, lagSeconds };
      const view = viewOf();
      const ingest = derivePipeline({
        view,
        link: 'live',
        lastAlertSink: 'ops-command-center',
        rows: [],
        seriesOf: () => [],
        rates,
        publishRate: 2,
      }).find((stage) => stage.id === 'ingest');
      const lag = kpis(view, { rates }).lag;
      expect(lag.known && `${lag.text} s lag`).toBe(ingest?.headline);
    }
  });

  it('is unknown, with the reason, and never zero', () => {
    const down = viewOf((v) => {
      v.ingest.status = 'unreachable';
    });
    expect(kpis(down).lag).toEqual({ known: false, reason: 'ingest does not answer' });
    const starting = viewOf((v) => {
      v.ingest.status = 'unknown';
    });
    expect(kpis(starting).lag.known).toBe(false);
    const stale = viewOf((v) => {
      v.metrics.stale = true;
    });
    expect(kpis(stale).lag).toEqual({ known: false, reason: 'the metrics could not be read' });
    expect(kpis(viewOf(), { rates: { storedPerSecond: null, lagSeconds: null } }).lag).toEqual({
      known: false,
      reason: 'no reading was stored between the last two reads',
    });
  });
});

describe('alert delivery', () => {
  it('counts the feed by delivery state', () => {
    const view = viewOf((v) => {
      v.alerts.alerts = [
        alert({ id: '4', deliveryStatus: 'delivered' }),
        alert({ id: '3', deliveryStatus: 'delivered' }),
        alert({ id: '2', deliveryStatus: 'pending' }),
        alert({ id: '1', deliveryStatus: 'skipped' }),
      ];
    });
    expect(kpis(view).delivery).toMatchObject({
      known: true,
      delivered: 2,
      total: 4,
      pending: 1,
      failed: 0,
      tone: 'warn',
    });
  });

  it('is bad when one failed, ok when all went through, and counts nothing for an empty feed', () => {
    const failed = viewOf((v) => {
      v.alerts.alerts = [alert({ deliveryStatus: 'failed' })];
    });
    expect(kpis(failed).delivery).toMatchObject({ failed: 1, tone: 'bad' });
    expect(kpis(viewOf()).delivery).toMatchObject({ delivered: 1, total: 1, tone: 'ok' });
    const empty = viewOf((v) => {
      v.alerts.alerts = [];
    });
    expect(kpis(empty).delivery).toMatchObject({ known: true, delivered: 0, total: 0, tone: 'ok' });
  });

  it('is unknown without a command center, and while the alerts cannot be read', () => {
    const none = viewOf((v) => {
      v.ingest.alertSink = 'none';
    });
    expect(kpis(none).delivery).toMatchObject({ known: false });
    const down = viewOf((v) => {
      v.ingest.status = 'unreachable';
      v.ingest.alertSink = null;
    });
    expect(kpis(down).delivery).toEqual({ known: false, reason: 'ingest does not answer' });
  });

  it('uses the last sink ingest reported when the state carries none', () => {
    const view = viewOf((v) => {
      v.ingest.alertSink = null;
    });
    expect(kpis(view, { lastAlertSink: 'none' }).delivery.known).toBe(false);
    expect(kpis(view, { lastAlertSink: 'ops-command-center' }).delivery.known).toBe(true);
  });
});

describe('not reporting', () => {
  it('lists the devices the Fleet calls paused, stopped or silent, with the word', () => {
    const rows = [
      row('a', 'running'),
      row('b', 'paused'),
      row('c', 'anomaly'),
      row('d', 'silent'),
      row('e', 'stopped'),
    ];
    const { notReporting } = kpis(viewOf(), { rows });
    expect(notReporting).toMatchObject({ known: true, count: 3, tone: 'warn' });
    expect(notReporting.devices).toEqual([
      { id: 'b', word: 'paused' },
      { id: 'd', word: 'silent' },
      { id: 'e', word: 'stopped' },
    ]);
  });

  it('is ok with none', () => {
    expect(kpis(viewOf(), { rows: [row('a', 'running')] }).notReporting).toMatchObject({
      count: 0,
      tone: 'ok',
    });
  });
});

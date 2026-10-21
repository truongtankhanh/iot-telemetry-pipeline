import type { MetricSample, Severity, StateView } from '../api/types';
import { severityOf } from './alertRows';
import type { FleetRow } from './fleetQuery';
import type { IngestRates } from './ingestRates';
import { STATUS_WORDS } from './deviceStatus';

/**
 * The six figures of the Overview's first row (frame 11), each computed from the source its detail page reads, so the
 * two agree at the same moment: the devices from the engine's states (the Fleet's "Active devices"), the alerts from
 * the feed the Alerts page and the Topology read, the rate from the stream (the Fleet's "Rate"), the lag from the same
 * `IngestRates` the Topology's Ingest stage uses, the delivery from the alerts' `deliveryStatus`, and the devices
 * that are not reporting from the Fleet's statuses. A figure whose source does not answer is **unknown**, with the reason
 * in words; it is never a zero.
 */

/** The most alerts the simulator's poll keeps (`alertsLimit` of `IngestPoller`): the feed is the newest of them. */
export const ALERT_FEED_LIMIT = 100;

export type KpiTone = 'ok' | 'warn' | 'bad' | 'unknown';

interface Known {
  known: true;
}
interface Unknown {
  known: false;
  /** Why the figure is not known, in a sentence. */
  reason: string;
}

export type DevicesKpi = {
  /** Registered devices. */
  total: number;
  /** Engine state `running`, anomaly or not (the brief: availability is running over registered). */
  online: number;
  paused: number;
  stopped: number;
  /** `online / total` in percent, one decimal; `null` with no device. */
  availability: number | null;
  tone: KpiTone;
} & Known;

export type AlertsKpi =
  | ({
      /** Open alerts of the feed. */
      open: number;
      bySeverity: Record<Severity, number>;
      /** The feed holds as many alerts as the poll keeps, so an older open alert may not be in it. */
      feedFull: boolean;
      tone: KpiTone;
    } & Known)
  | Unknown;

export type RateKpi = {
  perSecond: number;
  perMinute: number;
  /** `telemetry_sequence_gaps_total`, or `null` when ingest's metrics are not readable. */
  sequenceGaps: number | null;
  /** Why the rate is what it is, when that is not a fault (a stepped clock publishes only on a step). */
  note: string | null;
  tone: KpiTone;
} & Known;

export type LagKpi =
  | ({
      seconds: number;
      /** `0.04`, `1.2`: the digits the Topology's Ingest stage shows. */
      text: string;
      tone: KpiTone;
    } & Known)
  | Unknown;

export type DeliveryKpi =
  | ({
      delivered: number;
      /** Alerts in the feed. */
      total: number;
      pending: number;
      failed: number;
      tone: KpiTone;
    } & Known)
  | Unknown;

export type NotReportingKpi = {
  count: number;
  devices: { id: string; word: string }[];
  tone: KpiTone;
} & Known;

export interface OverviewKpis {
  devices: DevicesKpi;
  alerts: AlertsKpi;
  rate: RateKpi;
  lag: LagKpi;
  delivery: DeliveryKpi;
  notReporting: NotReportingKpi;
}

export interface OverviewKpiInput {
  view: StateView;
  /** The Fleet's rows: the devices with their statuses. */
  rows: readonly FleetRow[];
  /** Messages per second on the stream. */
  publishRate: number;
  /** What ingest did between the last two reads of its metrics. */
  rates: IngestRates;
  /** The alert sink ingest last reported; the store keeps it while ingest is unreachable. */
  lastAlertSink: string | null;
}

const fixed = (value: number, digits: number) => value.toFixed(digits);

/** The digits of the lag as the Topology's Ingest stage writes them: two decimals under a second, else one. */
export const lagText = (seconds: number): string => fixed(seconds, seconds < 1 ? 2 : 1);

/** Why the alerts cannot be read, in a sentence; `null` when they can. */
function alertsUnavailable(view: StateView): string | null {
  const { ingest, alerts } = view;
  if (ingest.status === 'unreachable') return 'ingest does not answer';
  if (ingest.status === 'unknown') return 'ingest has not answered yet';
  if (alerts.stale || alerts.lastOkAt === null) return 'the alerts could not be read';
  return null;
}

function counter(samples: readonly MetricSample[], name: string): number | null {
  const matching = samples.filter((sample) => sample.name === name);
  return matching.length === 0 ? null : matching.reduce((sum, sample) => sum + sample.value, 0);
}

function devicesKpi(view: StateView): DevicesKpi {
  const total = view.devices.length;
  const states = view.engine.devices;
  const online = states.filter((d) => d.state === 'running').length;
  const paused = states.filter((d) => d.state === 'paused').length;
  // A registered device the engine does not list counts as stopped, as the Fleet's status does.
  const stopped = total - online - paused;
  return {
    known: true,
    total,
    online,
    paused,
    stopped,
    availability: total === 0 ? null : Math.round((online / total) * 1000) / 10,
    tone: total === 0 ? 'unknown' : online === total ? 'ok' : online === 0 ? 'bad' : 'warn',
  };
}

function alertsKpi(view: StateView): AlertsKpi {
  const reason = alertsUnavailable(view);
  if (reason !== null) return { known: false, reason };
  const feed = view.alerts.alerts;
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let open = 0;
  for (const alert of feed) {
    if (alert.status !== 'open') continue;
    open += 1;
    bySeverity[severityOf(alert.severity)] += 1;
  }
  return {
    known: true,
    open,
    bySeverity,
    feedFull: feed.length >= ALERT_FEED_LIMIT,
    tone: bySeverity.critical > 0 ? 'bad' : open > 0 ? 'warn' : 'ok',
  };
}

function rateKpi(view: StateView, publishRate: number): RateKpi {
  const gaps = view.metrics.stale
    ? null
    : counter(view.metrics.samples, 'telemetry_sequence_gaps_total');
  return {
    known: true,
    perSecond: publishRate,
    perMinute: Math.round(publishRate * 60),
    sequenceGaps: gaps,
    note: view.engine.simulated ? 'stepped clock: nothing is published between steps' : null,
    tone: 'ok',
  };
}

function lagKpi(view: StateView, rates: IngestRates): LagKpi {
  const { ingest } = view;
  if (ingest.status === 'unreachable') return { known: false, reason: 'ingest does not answer' };
  if (ingest.status === 'unknown') return { known: false, reason: 'ingest has not answered yet' };
  if (view.metrics.stale) return { known: false, reason: 'the metrics could not be read' };
  if (rates.lagSeconds === null) {
    return { known: false, reason: 'no reading was stored between the last two reads' };
  }
  return {
    known: true,
    seconds: rates.lagSeconds,
    text: lagText(rates.lagSeconds),
    tone: 'ok',
  };
}

function deliveryKpi(view: StateView, lastAlertSink: string | null): DeliveryKpi {
  const reason = alertsUnavailable(view);
  if (reason !== null) return { known: false, reason };
  const sink = view.ingest.alertSink ?? lastAlertSink;
  if (sink === 'none') {
    return { known: false, reason: 'ingest has no command center configured (alert sink: none)' };
  }
  const feed = view.alerts.alerts;
  const count = (status: string) => feed.filter((a) => a.deliveryStatus === status).length;
  const failed = count('failed');
  const pending = count('pending');
  return {
    known: true,
    delivered: count('delivered'),
    total: feed.length,
    pending,
    failed,
    tone: failed > 0 ? 'bad' : pending > 0 ? 'warn' : 'ok',
  };
}

function notReportingKpi(rows: readonly FleetRow[]): NotReportingKpi {
  const away = rows.filter((row) =>
    (['paused', 'stopped', 'silent'] as const).some((kind) => kind === row.status.kind),
  );
  return {
    known: true,
    count: away.length,
    devices: away.map((row) => ({
      id: row.device.id,
      word: STATUS_WORDS[row.status.kind].toLowerCase(),
    })),
    tone: away.length === 0 ? 'ok' : 'warn',
  };
}

/** The six figures for one moment. Pure: the same input gives the same figures. */
export function overviewKpis(input: OverviewKpiInput): OverviewKpis {
  const { view, rows, publishRate, rates, lastAlertSink } = input;
  return {
    devices: devicesKpi(view),
    alerts: alertsKpi(view),
    rate: rateKpi(view, publishRate),
    lag: lagKpi(view, rates),
    delivery: deliveryKpi(view, lastAlertSink),
    notReporting: notReportingKpi(rows),
  };
}

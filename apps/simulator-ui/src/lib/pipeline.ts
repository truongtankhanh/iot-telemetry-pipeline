import type { ObservedAlert, StateView } from '../api/types';
import type { Sample } from '../state/history';
import type { LinkState } from '../state/store';
import type { FleetRow } from './fleetQuery';
import type { IngestRates } from './ingestRates';
import { rulesFor } from './rules';
import { formatClockTime } from './time';
import { breachRun } from './topologyDetail';
import type { TopologyState } from './topologyState';

export type StageId =
  'broker' | 'ingest' | 'database' | 'rules' | 'alert' | 'outbox' | 'commandCenter';

/** The stages of the pipeline after a device, in the order a reading and its alert pass through them. */
export const STAGE_ORDER: readonly StageId[] = [
  'broker',
  'ingest',
  'database',
  'rules',
  'alert',
  'outbox',
  'commandCenter',
];

export const STAGE_LABELS: Record<StageId, string> = {
  broker: 'Broker',
  ingest: 'Ingest',
  database: 'Database',
  rules: 'Rules',
  alert: 'Alert',
  outbox: 'Outbox',
  commandCenter: 'Command Center',
};

/** One stage of the pipeline as the graph draws it. */
export interface StageNode {
  id: StageId;
  label: string;
  state: TopologyState;
  /** What the state is, in a word: "Healthy", "Unreachable", "Unknown", "Not configured"… A state is never colour alone. */
  word: string;
  /** The main figure under the label. */
  headline: string | null;
  /** The smaller line under it. */
  detail: string | null;
  /** When the figures were last known to be true, when they are the last answer of a source that stopped answering. */
  asOf: number | null;
  /** The node shows an old answer (ingest does not answer, or the link to the simulator is lost): it is drawn dimmed. */
  dimmed: boolean;
}

export interface PipelineInput {
  view: StateView;
  link: LinkState;
  /** The alert sink ingest last reported; the store keeps it while ingest is unreachable. */
  lastAlertSink: string | null;
  /** The devices with their state, for the rules. */
  rows: readonly FleetRow[];
  /** The history of a metric of a device. */
  seriesOf: (deviceId: string, metric: string) => readonly Sample[];
  rates: IngestRates;
  /** Messages per second on the stream. */
  publishRate: number;
}

const answers = (status: StateView['ingest']['status']) =>
  status === 'ready' || status === 'not-ready';

const clock = (iso: string) => formatClockTime(Date.parse(iso));

/** The time ingest last answered, as far as Studio knows: the last good read of its alerts or metrics. */
function lastAnswerAt(view: StateView): number | null {
  const iso = view.alerts.lastOkAt ?? view.metrics.lastOkAt;
  return iso === null ? null : Date.parse(iso);
}

/** Rules: which device is closest to opening which alert, counted by Studio from the readings it saw. */
function rulesStage(
  input: PipelineInput,
): Pick<StageNode, 'state' | 'word' | 'headline' | 'detail'> {
  const { view, rows, seriesOf } = input;
  if (!view.rules.available) {
    return {
      state: 'stale',
      word: 'Not available',
      headline: 'Rules not available',
      detail: view.rules.reason,
    };
  }

  let best: { ruleId: string; deviceId: string; counted: number; of: number } | null = null;
  for (const row of rows) {
    // A paused or stopped device sends nothing, so its last readings are not a rule being met now.
    if (row.status.kind === 'paused' || row.status.kind === 'stopped') continue;
    for (const metric of row.device.metrics) {
      for (const rule of rulesFor(view.rules, row.device, metric)) {
        const run = breachRun(seriesOf(row.device.id, metric), rule).length;
        if (run === 0) continue;
        const counted = Math.min(run, rule.for);
        if (best === null || counted / rule.for > best.counted / best.of) {
          best = { ruleId: rule.id, deviceId: row.device.id, counted, of: rule.for };
        }
      }
    }
  }
  if (best === null) {
    const n = view.rules.items.length;
    return {
      state: 'healthy',
      word: 'Healthy',
      headline: `${n} ${n === 1 ? 'rule' : 'rules'}`,
      detail: 'none beyond a raise line',
    };
  }
  return {
    state: 'anomaly',
    word: 'Anomaly',
    headline: best.ruleId,
    detail: `${best.counted} of ${best.of} readings · ${best.deviceId}`,
  };
}

/** The delivery of the alerts, from the newest alert's outbox state; a failure anywhere counts. */
function outboxStage(
  alerts: readonly ObservedAlert[],
): Pick<StageNode, 'state' | 'word' | 'headline' | 'detail'> {
  const failed = alerts.find((alert) => alert.deliveryStatus === 'failed');
  if (failed !== undefined) {
    return {
      state: 'down',
      word: 'Failed',
      headline: `#${failed.id} not delivered`,
      detail: failed.deliveryError ?? `${failed.deliveryAttempts ?? 0} attempts`,
    };
  }
  const newest = alerts[0];
  if (newest === undefined) {
    return { state: 'healthy', word: 'Idle', headline: 'nothing to deliver', detail: null };
  }
  const attempts =
    newest.deliveryAttempts === null
      ? null
      : `${newest.deliveryAttempts} ${newest.deliveryAttempts === 1 ? 'attempt' : 'attempts'}`;
  switch (newest.deliveryStatus) {
    case 'delivered':
      return {
        state: 'healthy',
        word: 'Delivered',
        headline: `#${newest.id} delivered`,
        detail: attempts,
      };
    case 'pending':
      return {
        state: 'anomaly',
        word: 'Pending',
        headline: `#${newest.id} waiting`,
        detail: attempts,
      };
    case 'skipped':
      return { state: 'stale', word: 'Skipped', headline: `#${newest.id} skipped`, detail: null };
    default:
      // A status ingest adds later, or none: unknown, never healthy.
      return { state: 'stale', word: 'Unknown', headline: `#${newest.id}`, detail: null };
  }
}

function alertStage(
  alerts: readonly ObservedAlert[],
): Pick<StageNode, 'state' | 'word' | 'headline' | 'detail'> {
  const open = alerts.filter((alert) => alert.status === 'open');
  const newest = open[0];
  if (newest === undefined) {
    const last = alerts[0];
    return {
      state: 'healthy',
      word: 'Quiet',
      headline: 'no open alert',
      detail:
        last === undefined
          ? null
          : `#${last.id} ${last.clearedAt === null ? 'seen' : `cleared ${clock(last.clearedAt)}`}`,
    };
  }
  return {
    state: 'anomaly',
    word: 'Open',
    headline: `#${newest.id} · ${newest.severity}`,
    detail: `opened ${clock(newest.openedAt)}${open.length > 1 ? ` · +${open.length - 1} more open` : ''}`,
  };
}

function commandCenterStage(
  alerts: readonly ObservedAlert[],
  sink: string | null,
): Pick<StageNode, 'state' | 'word' | 'headline' | 'detail'> {
  if (sink === null) {
    return { state: 'stale', word: 'Unknown', headline: null, detail: null };
  }
  if (sink === 'none') {
    return {
      state: 'stale',
      word: 'Not configured',
      headline: 'not configured',
      detail: 'alertSink: none',
    };
  }
  if (alerts.some((alert) => alert.deliveryStatus === 'failed')) {
    return { state: 'down', word: 'Failing', headline: 'not accepting alerts', detail: null };
  }
  const withIncident = alerts.find((alert) => alert.externalRef !== null);
  if (withIncident?.externalRef) {
    return {
      state: 'healthy',
      word: 'Incident',
      headline: `incident ${withIncident.externalRef.slice(0, 4)}…`,
      detail: `for alert #${withIncident.id}`,
    };
  }
  return { state: 'healthy', word: 'Ready', headline: 'no incident yet', detail: null };
}

const fixed = (value: number, digits: number) => value.toFixed(digits);

/**
 * The seven stages after the devices (frames 04 and 10), with only what Studio can know. A figure that was not
 * measured is left out (no PUBACK time, no buffer size); the rules' count is Studio's own reading of the readings it
 * saw; the command center is never read, so "an incident exists" is all it says. When ingest does not answer, every
 * stage that depends on it keeps its last answer, dimmed and dated, and says "Unknown": the page never guesses.
 */
export function derivePipeline(input: PipelineInput): StageNode[] {
  const { view, link, lastAlertSink, rates, publishRate } = input;
  const { ingest, broker } = view;
  const answering = answers(ingest.status);
  const lost = link === 'lost';
  const seen = lastAnswerAt(view);
  const alerts = view.alerts.alerts;

  const make = (
    id: StageId,
    part: Pick<StageNode, 'state' | 'word' | 'headline' | 'detail'>,
    dimmed: boolean,
    asOf: number | null = null,
  ): StageNode => ({ id, label: STAGE_LABELS[id], ...part, asOf, dimmed: dimmed || lost });

  const noAnswer = (id: StageId): StageNode => {
    const checking = ingest.status === 'unknown';
    return make(
      id,
      {
        state: 'stale',
        word: checking ? 'Checking' : 'Unknown',
        headline: null,
        detail: checking || seen === null ? null : `as of ${formatClockTime(seen)}`,
      },
      true,
      checking ? null : seen,
    );
  };

  const brokerNode = make(
    'broker',
    broker.connected
      ? {
          state: 'healthy',
          word: 'Connected',
          headline: broker.port === null ? 'connected' : `:${broker.port}`,
          detail: `${fixed(publishRate, 1)} msg/s`,
        }
      : { state: 'down', word: 'Disconnected', headline: 'disconnected', detail: broker.url },
    false,
  );

  const ingestNode = (): StageNode => {
    switch (ingest.status) {
      case 'ready':
      case 'not-ready': {
        const lag =
          rates.lagSeconds === null
            ? null
            : `${fixed(rates.lagSeconds, rates.lagSeconds < 1 ? 2 : 1)} s lag`;
        const speed =
          rates.storedPerSecond === null ? null : `${fixed(rates.storedPerSecond, 1)} readings/s`;
        const down = [
          ingest.database === 'down' ? 'database down' : null,
          ingest.broker === 'down' ? 'broker down' : null,
        ].filter((reason): reason is string => reason !== null);
        return ingest.status === 'ready'
          ? make(
              'ingest',
              {
                state: 'healthy',
                word: 'Ready',
                headline: lag ?? 'ready',
                detail: speed,
              },
              false,
            )
          : make(
              'ingest',
              {
                state: 'anomaly',
                word: 'Not ready',
                headline: 'not ready',
                detail: down.length > 0 ? down.join(', ') : null,
              },
              false,
            );
      }
      case 'unreachable':
        return make(
          'ingest',
          {
            state: 'down',
            word: 'Unreachable',
            headline: 'Unreachable',
            detail: seen === null ? null : `seen ${formatClockTime(seen)}`,
          },
          false,
          seen,
        );
      default:
        return noAnswer('ingest');
    }
  };

  const databaseNode = (): StageNode => {
    if (!answering) return noAnswer('database');
    const speed =
      rates.storedPerSecond === null ? null : `${fixed(rates.storedPerSecond, 1)} stored/s`;
    return ingest.database === 'up'
      ? make('database', { state: 'healthy', word: 'Up', headline: 'up', detail: speed }, false)
      : make(
          'database',
          {
            state: 'down',
            word: 'Down',
            headline: 'down',
            detail: ingest.database === null ? null : `ingest reports ${ingest.database}`,
          },
          false,
        );
  };

  const sink = answering ? ingest.alertSink : lastAlertSink;

  return [
    brokerNode,
    ingestNode(),
    databaseNode(),
    answering ? make('rules', rulesStage(input), false) : noAnswer('rules'),
    answering ? make('alert', alertStage(alerts), false) : noAnswer('alert'),
    !answering
      ? noAnswer('outbox')
      : sink === 'none'
        ? make(
            'outbox',
            {
              state: 'stale',
              word: 'No sink',
              headline: 'not delivering',
              detail: 'alertSink: none',
            },
            false,
          )
        : make('outbox', outboxStage(alerts), false),
    !answering
      ? sink === 'none'
        ? // The last thing ingest said was that it has no command center: still true, but old.
          make('commandCenter', commandCenterStage(alerts, sink), true, seen)
        : noAnswer('commandCenter')
      : make('commandCenter', commandCenterStage(alerts, sink), false),
  ];
}

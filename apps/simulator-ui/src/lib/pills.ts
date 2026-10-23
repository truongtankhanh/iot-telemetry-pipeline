import type { StateView } from '../api/types';
import type { LinkState } from '../state/store';

export type PillTone = 'ok' | 'warn' | 'bad' | 'unknown';

export interface Pill {
  id: 'broker' | 'ingest' | 'commandCenter' | 'running' | 'faults';
  label: string;
  /** A port, a reason, a count: the small text after the label. */
  detail: string | null;
  tone: PillTone;
  /** True when the data behind it is old (the link to the simulator is lost, or ingest is not answering). */
  stale: boolean;
}

export interface PillInput {
  view: StateView | null;
  link: LinkState;
  /** Messages per second on the stream. */
  publishRate: number;
  /** The alert sink ingest last reported, kept by the store while ingest is unreachable. */
  lastAlertSink: string | null;
}

/** `:3100` from `http://localhost:3100`; `null` when the URL has no port to show. */
export function portOf(url: string): string | null {
  try {
    const { port } = new URL(url);
    return port === '' ? null : port;
  } catch {
    return null;
  }
}

const port = (value: string | number | null) => (value === null ? null : `:${value}`);

function brokerPill(view: StateView, stale: boolean): Pill {
  const { connected, port: brokerPort } = view.broker;
  return {
    id: 'broker',
    label: 'Broker',
    detail: connected ? port(brokerPort) : 'disconnected',
    tone: connected ? 'ok' : 'bad',
    stale,
  };
}

function ingestPill(view: StateView, stale: boolean): Pill {
  const { ingest } = view;
  const ingestPort = port(portOf(view.config.ingestUrl));
  switch (ingest.status) {
    case 'ready':
      return { id: 'ingest', label: 'Ingest', detail: ingestPort, tone: 'ok', stale };
    case 'not-ready': {
      const down = [
        ingest.database === 'down' ? 'database down' : null,
        ingest.broker === 'down' ? 'broker down' : null,
      ].filter((reason): reason is string => reason !== null);
      return {
        id: 'ingest',
        label: 'Ingest',
        detail: down.length > 0 ? `not ready · ${down.join(', ')}` : 'not ready',
        tone: 'warn',
        stale,
      };
    }
    case 'unreachable':
      return { id: 'ingest', label: 'Ingest', detail: 'unreachable', tone: 'bad', stale };
    default:
      return { id: 'ingest', label: 'Ingest', detail: 'checking', tone: 'unknown', stale };
  }
}

/**
 * The Command Center is not read directly: ingest says whether it has an alert sink, and an alert whose
 * delivery failed says the sink is not taking them. While ingest does not answer, the last sink it
 * reported is shown, dimmed, so a demo without a command center does not turn into a mystery.
 */
function commandCenterPill(view: StateView, lastAlertSink: string | null, stale: boolean): Pill {
  const answering = view.ingest.status === 'ready' || view.ingest.status === 'not-ready';
  const sink = answering ? view.ingest.alertSink : lastAlertSink;
  const sinkStale = stale || !answering;
  if (sink === null) {
    return {
      id: 'commandCenter',
      label: 'Command Center',
      detail: 'unknown',
      tone: 'unknown',
      stale: true,
    };
  }
  if (sink === 'none') {
    return {
      id: 'commandCenter',
      label: 'Command Center',
      detail: 'not configured',
      tone: 'warn',
      stale: sinkStale,
    };
  }
  const failing = view.alerts.alerts.some((alert) => alert.deliveryStatus === 'failed');
  return failing
    ? {
        id: 'commandCenter',
        label: 'Command Center',
        detail: 'delivery failing',
        tone: 'bad',
        stale: sinkStale,
      }
    : { id: 'commandCenter', label: 'Command Center', detail: null, tone: 'ok', stale: sinkStale };
}

function runningPill(view: StateView, publishRate: number, stale: boolean): Pill {
  const { engine } = view;
  const total = engine.devices.length;
  const running = engine.devices.filter((device) => device.state === 'running').length;
  const counts = `${running} of ${total} devices`;
  if (!engine.running)
    return { id: 'running', label: 'Stopped', detail: counts, tone: 'warn', stale };
  if (running === 0) return { id: 'running', label: 'Paused', detail: counts, tone: 'warn', stale };
  return {
    id: 'running',
    label: 'Running',
    detail: `${counts} · ${publishRate.toFixed(1)} msg/s`,
    tone: 'ok',
    stale,
  };
}

/**
 * Faults are on: amber, with how many. It exists only while the engine has a fault on (`activeCount` counts the switches and
 * link loss while the link is down, not a burst): a pill that was always there, saying "none", would not be noticed on the day
 * it matters. Dimmed with the others when the link to the simulator is lost, because then it is the last known state.
 */
function faultsPill(view: StateView, stale: boolean): Pill | null {
  const { activeCount } = view.engine.faults;
  if (activeCount <= 0) return null;
  return {
    id: 'faults',
    label: 'Faults on',
    detail: `${activeCount} active`,
    tone: 'warn',
    stale,
  };
}

/**
 * The four pills of the header: Broker, Ingest, Command Center and the engine. Nothing is drawn healthy
 * that is not known to be: before the first message every pill is unknown, and with the link lost every
 * pill keeps its last data but is stale (dimmed, and dated by the header). A fifth, "Faults on", is added while any fault is on.
 */
export function derivePills({ view, link, publishRate, lastAlertSink }: PillInput): Pill[] {
  const stale = link === 'lost';
  if (view === null) {
    const detail = stale ? 'no data' : 'connecting';
    return [
      { id: 'broker', label: 'Broker', detail, tone: 'unknown', stale },
      { id: 'ingest', label: 'Ingest', detail, tone: 'unknown', stale },
      { id: 'commandCenter', label: 'Command Center', detail, tone: 'unknown', stale },
      { id: 'running', label: 'Engine', detail, tone: 'unknown', stale },
    ];
  }
  const faults = faultsPill(view, stale);
  return [
    brokerPill(view, stale),
    ingestPill(view, stale),
    commandCenterPill(view, lastAlertSink, stale),
    runningPill(view, publishRate, stale),
    ...(faults === null ? [] : [faults]),
  ];
}

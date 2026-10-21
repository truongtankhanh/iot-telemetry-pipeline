/**
 * What Studio reads from the simulator's control API. Written by hand, as a mirror of the part Studio
 * uses; the shapes live in apps/simulator and a test on each side keeps them honest: `fixtures/state-view.json`
 * is a real `GET /api/state` body, whose keys `client.test.ts` compares with the ones declared here, and
 * `apps/simulator/src/control-routes.test.ts` fails when `buildStateView` stops returning the keys of
 * that same file. (A type assertion on JSON checks little; the key lists are the check.)
 * (Why not import the simulator's types: they pull Node typings into browser code. ADR-0011, SIM-04.)
 */
import type { MetricName } from '@itp/telemetry-contract';

export type DeviceState = 'running' | 'paused' | 'stopped';

/** A device as the registry (`devices.json`) describes it. */
export interface DeviceInfo {
  id: string;
  kind: string;
  zoneCode: string;
  metrics: MetricName[];
  /** In the registry file; not in the simulator's `DeviceSpec` type, so optional here. */
  name?: string;
}

export interface Anomaly {
  deviceId: string;
  metric: MetricName;
  value: number;
  startAt: number;
  duration: number;
  shape?: 'step' | 'ramp' | 'spike';
}

export interface EngineSnapshot {
  running: boolean;
  /** True when the engine runs on a manual clock: Step and Reset exist. */
  simulated: boolean;
  nowMs: number;
  elapsedS: number;
  intervalMs: number;
  published: number;
  devices: {
    id: string;
    state: DeviceState;
    intervalMs: number;
    seq: number;
    holds: Partial<Record<MetricName, number>>;
  }[];
  anomalies: { id: string; anomaly: Anomaly }[];
}

export type IngestStatus = 'unknown' | 'ready' | 'not-ready' | 'unreachable';

/** What `GET /api/ready` of ingest says, or that it did not answer. */
export interface IngestState {
  status: IngestStatus;
  database: string | null;
  broker: string | null;
  /** `none` when ingest has no command center configured, else `ops-command-center`. */
  alertSink: string | null;
  detail: string | null;
  since: string | null;
  lastCheckedAt: string | null;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** An alert of ingest with the times Studio first saw things happen (observed, not ingest's). */
export interface ObservedAlert {
  id: string;
  deviceId: string;
  ruleId: string;
  metric: string;
  severity: string;
  title: string;
  status: 'open' | 'cleared';
  openedAt: string;
  openedValue: number | null;
  clearedAt: string | null;
  clearedValue: number | null;
  externalRef: string | null;
  deliveryStatus: string | null;
  deliveryAttempts: number | null;
  deliveryError: string | null;
  preexisting: boolean;
  observed: {
    openedAt: string | null;
    clearedAt: string | null;
    delivered: { opened: string | null; cleared: string | null };
    incident: string | null;
  };
}

export interface AlertsFeed {
  alerts: ObservedAlert[];
  lastOkAt: string | null;
  stale: boolean;
}

/** Why an alert exists, when Studio can tell: a scenario it started (`cause` of `GET /api/alerts`). */
export interface AlertCause {
  scenario: string;
  /** When Studio saw the run start (wall time, ISO 8601). */
  startedAt: string;
}

/**
 * An alert of `GET /api/alerts`: the observed alert of the state view, and its cause. A manual mirror of
 * `PagedAlert` in `apps/simulator/src/control-routes.ts`, kept honest by `fixtures/alerts-page.json`: both sides
 * compare their keys with that file.
 */
export interface PagedAlert extends ObservedAlert {
  cause: AlertCause | null;
}

/** One page of alerts, newest first, and the cursor of the next one: ingest's `X-Next-Cursor`, unchanged. */
export interface AlertsPage {
  alerts: PagedAlert[];
  /** `null` on the last page. Opaque: only ever sent back as `before`, never read or built. */
  next: string | null;
}

export interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface MetricsFeed {
  samples: MetricSample[];
  lastOkAt: string | null;
  stale: boolean;
}

/** One threshold rule of ingest (`rules.json`), as the simulator reports it for the charts and range bars. */
export interface RuleInfo {
  id: string;
  /** The device kind the rule applies to. */
  kind: string;
  metric: MetricName;
  direction: 'above' | 'below';
  /** The value that counts as a breach (strictly beyond it). */
  raise: number;
  /** The value an open alert must get back past to clear; the hysteresis band lies between the two. */
  clear: number;
  /** Consecutive breaching readings needed to open an alert. */
  for: number;
  severity: Severity;
  title: string;
}

/** The rules the simulator read at boot, or why it has none (the UI then hides what depends on them). */
export interface RulesView {
  available: boolean;
  /** Why the rules are not available, in words; `null` when they are. */
  reason: string | null;
  items: RuleInfo[];
}

/** Baseline, noise (±) and daily swing of one metric of one device, in the metric's unit. Read-only. */
export interface MetricProfile {
  baseline: number;
  noise: number;
  dailySwing: number;
}

/** The simulator's own connection to the MQTT broker (credentials already removed). */
export interface BrokerState {
  url: string;
  port: number | null;
  connected: boolean;
}

/** A scenario that Studio started and that is still playing; elapsed time is `engine.elapsedS − offsetS`. */
export interface ScenarioRunView {
  id: string;
  scenario: string;
  /** When the run was started (wall time, ISO 8601). */
  startedAt: string;
  /** The engine's anomaly clock (`engine.elapsedS`) at second 0 of the scenario. */
  offsetS: number;
  /** The anomaly clock at the end of the scenario's last anomaly. */
  endsAtS: number;
  anomalyIds: string[];
  /** Devices the run found stopped or paused and started. */
  startedDevices: string[];
}

/** The answer of `GET /api/state` and of every command. */
export interface StateView {
  engine: EngineSnapshot;
  devices: DeviceInfo[];
  /** The names in the scenario library; the library read has the rest. */
  scenarios: string[];
  /** The scenarios that are playing now. */
  runs: ScenarioRunView[];
  ingest: IngestState;
  broker: BrokerState;
  alerts: AlertsFeed;
  metrics: MetricsFeed;
  rules: RulesView;
  /** By device id; a device has an entry for each of its metrics. */
  profiles: Record<string, Partial<Record<MetricName, MetricProfile>>>;
  config: { ingestUrl: string; consoleUrl: string | null; intervalMs: number; simulated: boolean };
  observationCursor: number;
}

export interface PublishedMessage {
  deviceId: string;
  topic: string;
  payload: string;
  seq: number;
  ts: string;
}

/** The first message of the event stream: the state view plus the last published messages. */
export interface Snapshot extends StateView {
  publishLog: PublishedMessage[];
}

/** The events of `GET /api/stream` that Studio listens to. */
export type StreamEventName =
  | 'snapshot'
  | 'state'
  | 'published'
  | 'ingest'
  | 'alerts'
  | 'metrics'
  | 'broker'
  | 'tick-error'
  | 'observation';

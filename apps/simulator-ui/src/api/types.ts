/**
 * What Studio reads from the simulator's control API. Written by hand, as a mirror of the part Studio
 * uses; the shapes live in apps/simulator and a test on each side keeps them honest: `fixtures/state-view.json`
 * is a real `GET /api/state` body, whose keys `client.test.ts` compares with the ones declared here, and
 * `apps/simulator/src/control-routes.test.ts` fails when `buildStateView` stops returning the keys of
 * that same file. (A type assertion on JSON checks little; the key lists are the check.) The scenario library has
 * the same arrangement with `fixtures/scenarios.json`.
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
  faults: FaultsSnapshot;
}

/** The reasons a malformed payload can be rejected for, one generator each: the parser's nine, and `topic`. */
export type MalformedKind =
  'size' | 'json' | 'shape' | 'seq' | 'ts' | 'empty' | 'metric' | 'value' | 'range' | 'topic';

/** Which devices the faults and a burst act on. */
export type FaultScope = { mode: 'running' } | { mode: 'selected'; deviceIds: string[] };

/** The faults the engine has on, as `snapshot()` says; an absent fault is `null`. */
export interface FaultsSnapshot {
  scope: FaultScope;
  drop: { percent: number } | null;
  duplicate: { percent: number } | null;
  delay: { delayMs: number; jitterMs: number } | null;
  reorder: { window: number } | null;
  malformed: { percent: number; kinds: MalformedKind[] } | null;
  /** While the link to the broker is down: since when (the engine's clock) and the automatic restore, if any. */
  linkLoss: { since: string; forS: number | null } | null;
  /** Switches that are on, plus link loss while it is down; a burst is a one-shot and is not counted. */
  activeCount: number;
  /** Running devices in scope now (the chosen ones, for a selection). */
  deviceCount: number;
  /** Messages held back now by a delay or a reorder window. */
  held: number;
  /** Messages dropped by a fault or by link loss since the simulator started. */
  dropped: number;
  bursting: boolean;
}

/** When the faults began and what ingest's counters said then; `null` until a fault has been switched on. */
export interface FaultEffectView {
  since: string;
  /** The four counters of the effect panel at that moment; `null` when ingest had not been read. */
  baseline: MetricSample[] | null;
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
  faultEffect: FaultEffectView | null;
}

export interface PublishedMessage {
  deviceId: string;
  topic: string;
  payload: string;
  seq: number;
  ts: string;
  /** Present when the message is not a plain one: a second copy, a burst message or a malformed payload. */
  fault?: 'duplicate' | 'burst' | `malformed:${MalformedKind}`;
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

// ---- The scenario library (SIM-08) ----
// A manual mirror of `ScenarioItem` and the types around it in `apps/simulator/src/control-routes.ts`,
// `scenario-expectations.ts` and `scenario-runs.ts`. `fixtures/scenarios.json` is a `GET /api/scenarios` body: the
// key lists of `client.test.ts` and of `apps/simulator/src/control-routes.test.ts` are the check, from both sides.

export type ScenarioSource = 'built-in' | 'custom';

/** An alert the rules should raise while the scenario plays. Times are seconds from the scenario start. */
export interface ExpectedAlert {
  ruleId: string;
  title: string;
  severity: Severity;
  deviceId: string;
  metric: MetricName;
  opensAtS: number;
  /** A reading that counts toward the opening is within the jitter of the raise line: it may open later or never. */
  opensMargin: boolean;
  /** `null` when no reading comes back past the clear line within the simulator's search. */
  clearsAtS: number | null;
  /** The baseline is within the noise of the clear line (or there is no clear): it may take longer. */
  clearsUncertain: boolean;
}

/** An anomaly that raises nothing, and why. */
export interface QuietAnomaly {
  deviceId: string;
  metric: MetricName;
  why: 'no-rule' | 'never-crosses';
}

/** The noise-free value of one device and metric at `0, stepS, 2·stepS…` up to the horizon. */
export interface ExpectedSeries {
  deviceId: string;
  metric: MetricName;
  stepS: number;
  points: number[];
}

/** What the rules should do with a scenario, or why the simulator will not guess (`available: false`). */
export type Expected =
  | { available: false; reason: string }
  | {
      available: true;
      /** The engine's publish interval, which the tolerance of the numbers is measured in. */
      intervalS: number;
      /** The end of the picture: the end of the last anomaly, or the last clear if that comes later. */
      horizonS: number;
      alerts: ExpectedAlert[];
      quiet: QuietAnomaly[];
      series: ExpectedSeries[];
    };

/** A device that running the scenario would start, with the state it is in now. */
export interface ScenarioNeed {
  deviceId: string;
  state: 'stopped' | 'paused';
}

/** One scenario of the library with what a card is drawn from. */
export interface ScenarioItem {
  name: string;
  description: string;
  source: ScenarioSource;
  /** Imported during this session: it is not in the folder and ends with the process. */
  imported: boolean;
  anomalies: Anomaly[];
  /** Seconds from the scenario start to the end of its last anomaly. */
  lengthS: number;
  needsStart: ScenarioNeed[];
  /** When it was last run in this session (ISO 8601), or `null`. */
  lastRunAt: string | null;
  running: boolean;
  expected: Expected;
}

/** A file or built-in that the library did not keep, and why. */
export interface RejectedScenario {
  file: string;
  reason: string;
}

/** The answer of `GET /api/scenarios`. */
export interface ScenarioLibraryView {
  scenarios: ScenarioItem[];
  rejected: RejectedScenario[];
  /** The engine's publish interval in ms. */
  intervalMs: number;
}

/** An anomaly in the engine that a run would play over, and who owns it (`null`: no run, e.g. the command line's). */
export interface RunConflict {
  deviceId: string;
  anomalyId: string;
  runId: string | null;
  scenario: string | null;
}

/** What a run took out of the way: a whole earlier run, or the loose anomalies no run owns (`runId: null`). */
export interface ReplacedRun {
  runId: string | null;
  scenario: string | null;
  anomalyIds: string[];
}

/** The answer of `POST /api/scenarios/:name/run`: the state, and what the run did. */
export interface RunAnswer extends StateView {
  runId: string;
  anomalyIds: string[];
  startedDevices: string[];
  replaced: ReplacedRun[];
}

/** The answer of `POST /api/scenarios/import`: the state, and the scenario as a card shows it. */
export interface ImportAnswer extends StateView {
  scenario: ScenarioItem;
}

/**
 * The answer of `PUT /api/scenarios/:name` (`201` for a new name, `200` for a replacement): the same body as an import's,
 * the state and the scenario as a card shows it, now a file in the scenarios folder.
 */
export type SaveAnswer = ImportAnswer;

// ---- The observation log (SIM-09) ----
// A manual mirror of `ObservationEvent` in `apps/simulator/src/observation-store.ts`. `fixtures/observations.json` is a
// `GET /api/observations` body with one event of every kind: the key lists of `client.test.ts` and of
// `apps/simulator/src/control-routes.test.ts` are the check, from both sides.

/** Every kind of observation the simulator records. A reader meets an unknown one as `other`, not as an error. */
export const OBSERVATION_KINDS = [
  'engine-state',
  'tick-error',
  'scenario-run',
  'scenario-stop',
  'alert-opened',
  'alert-cleared',
  'delivery',
  'incident',
  'dependency',
] as const;

export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** Something the control server saw, in the order it saw it. `at` is when Studio saw it (wall time), not when it happened. */
export interface ObservationEvent {
  /** Strictly increasing from 1 for the life of the simulator process, whatever has been evicted. */
  id: number;
  /** ISO 8601. */
  at: string;
  kind: ObservationKind;
  /** What the kind carries; a reader tolerates a missing key. */
  data: Record<string, unknown>;
}

/** One page of observations, newest first, and the `before` of the next: the simulator's `X-Next-Cursor`. */
export interface ObservationsPage {
  events: ObservationEvent[];
  /** `null` on the last page. */
  next: number | null;
}

// ---- The Lab (SIM-10) ----
// A manual mirror of `ExpectationPreview` in `apps/simulator/src/control-routes.ts`. `fixtures/expectations.json` is a
// `POST /api/expectations` body: the key lists of `client.test.ts` and of `apps/simulator/src/control-routes.test.ts` are
// the check, from both sides.

/**
 * The answer of `POST /api/expectations`: what the rules should do with a list of anomalies that is in no scenario (the
 * fault being configured), worked out as the library does for a scenario. Times are seconds from now.
 */
export interface ExpectationPreview {
  expected: Expected;
  /** Devices the anomalies name that are not running now; the times assume they start with the fault, as a run would. */
  needsStart: ScenarioNeed[];
  /** The engine's publish interval in ms. */
  intervalMs: number;
}

/**
 * An anomaly to add to the engine (`POST /api/anomalies`): `startAt` is on the engine's anomaly clock
 * (`engine.elapsedS`), `startIn` is seconds from the moment the simulator receives it; give one, or neither for now.
 */
export type AnomalyRequest = Omit<Anomaly, 'startAt'> & { startAt?: number; startIn?: number };

/** The answer of `POST /api/anomalies`: the state, and the id the engine gave the anomaly (to remove it again). */
export interface AnomalyAnswer extends StateView {
  id: string;
}

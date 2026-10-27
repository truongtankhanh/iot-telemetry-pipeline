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
  /**
   * The benchmark without its series (`GET /api/benchmark` has them). It is the state at the moment of the snapshot or of the
   * last command: the simulator sends no `state` event when a run changes, so what a run is doing now is in the
   * `BenchmarkStore`, fed by the `benchmark` stream event. `available`, `reason`, `database` and `maxMessages` do not change
   * while the simulator runs.
   */
  benchmark: BenchmarkSummary;
}

export interface PublishedMessage {
  /**
   * From 1, increasing for the life of the simulator process: the key of a row and the id of a republish. Optional here
   * only so that the code written before the Event stream still compiles; the simulator always sends it.
   */
  id?: number;
  /** Wall time (ISO 8601) of the broker's acknowledgement; `ts` is the payload's and follows the engine's clock. */
  at?: string;
  /** Milliseconds, to a tenth, from handing the message to the client to its PUBACK (includes the client's own queueing). */
  ackMs?: number;
  deviceId: string;
  topic: string;
  payload: string;
  seq: number;
  ts: string;
  /**
   * Present when the message is not a plain one: a second copy, a burst message, a malformed payload, or one the operator
   * sent again from the log (`republish`).
   */
  fault?: 'duplicate' | 'burst' | 'republish' | `malformed:${MalformedKind}`;
}

/**
 * What the simulator's sampling of `published` events says: the stream forwards a budget of messages per window and
 * counts the rest. Sent as the `sampling` event once per window while it skips, and once more with `active: false`.
 */
export interface SamplingReport {
  /** Every message so far, forwarded or not. */
  total: number;
  skipped: number;
  forwarded: number;
  windowMs: number;
  budgetPerS: number;
  active: boolean;
}

/** The first message of the event stream: the state view plus the last published messages. */
export interface Snapshot extends StateView {
  publishLog: PublishedMessage[];
  /** Every message published so far, forwarded or not (the log holds only what was forwarded). */
  publishTotal?: number;
  /** Whether the stream is skipping messages now, and by what budget. */
  sampling?: { active: boolean; skipped: number; budgetPerS: number; windowMs: number };
}

/** The events of `GET /api/stream` that Studio listens to. */
export type StreamEventName =
  | 'snapshot'
  | 'state'
  | 'published'
  | 'sampling'
  | 'ingest'
  | 'alerts'
  | 'metrics'
  | 'broker'
  | 'tick-error'
  | 'observation'
  | 'benchmark';

// ---- The benchmark (SIM-15) ----
// A manual mirror of the types of `apps/simulator/src/benchmark-run.ts` and of `BenchResult` in `bench-run.ts`.
// `fixtures/state-view.json` has the summary in a `GET /api/state` body; the key check of
// `apps/simulator/src/control-routes.test.ts` is the check, from the simulator's side.

/** What a run measured: the fields of the `--json` line of `pnpm --filter @itp/simulator bench`, with the same formulas. */
export interface BenchResult {
  messages: number;
  readingsExpected: number;
  readingsStored: number;
  publishSeconds: number;
  endToEndSeconds: number;
  messagesPerSecond: number;
  readingsPerSecond: number;
  vcpu: number;
  node: string;
}

export type BenchmarkPhase = 'starting' | 'publishing' | 'waiting' | 'ended';
export type BenchmarkOutcome = 'completed' | 'incomplete' | 'stopped' | 'failed';

/** One sample of a run, about once a second. `null` is unknown, never zero. */
export interface BenchmarkPoint {
  /** Seconds since the run started, to a tenth. */
  t: number;
  /** Messages the broker acknowledged. */
  published: number;
  /** Readings stored since the run started. */
  stored: number | null;
  /** `telemetry_buffered_readings`. */
  buffered: number | null;
  /** The 95th percentile of the flush time over the last read, in seconds. */
  flushP95S: number | null;
  /**
   * Estimated queue delay in seconds: readings in flight over the rate they are stored at. Ingest's own lag cannot be read on
   * a benchmark run: its readings are stamped an hour in the past.
   */
  queueDelayS: number | null;
}

export interface BenchmarkRunSummary {
  /** The run's number in this session, from 1. */
  id: number;
  startedAt: string;
  endedAt: string | null;
  phase: BenchmarkPhase;
  outcome: BenchmarkOutcome | null;
  /** Why a run did not complete, in words. */
  reason: string | null;
  /** True only for a run that completed; `null` while it runs. */
  comparable: boolean | null;
  settings: { messages: number; devices: number; timeoutS: number };
  expectedReadings: number;
  /** Messages acknowledged. */
  published: number;
  /** Readings stored so far, or `null` when it cannot be known. */
  stored: number | null;
  elapsedMs: number;
  result: BenchResult | null;
  marks: { publishEndedS: number | null; rampUpEndS: number | null };
}

export interface BenchmarkRunDetail extends BenchmarkRunSummary {
  series: BenchmarkPoint[];
}

export interface BenchmarkSummary {
  available: boolean;
  /** Why it is not available. */
  reason: string | null;
  /** `host:port/name` of the database a run counts in; never credentials. */
  database: string | null;
  maxMessages: number;
  running: boolean;
  current: BenchmarkRunSummary | null;
  /** Finished runs, newest first (the last ten). */
  runs: BenchmarkRunSummary[];
}

/** The answer of `GET /api/benchmark`: the summary with the series. */
export interface BenchmarkDetail extends Omit<BenchmarkSummary, 'current' | 'runs'> {
  current: BenchmarkRunDetail | null;
  runs: BenchmarkRunDetail[];
}

export interface BenchmarkCheck {
  id: 'ingest' | 'database' | 'fleet';
  label: string;
  ok: boolean;
  reason: string | null;
}

/** The `benchmark` event of the stream: the run, and the new series point when it carries one. */
export interface BenchmarkEvent {
  run: BenchmarkRunSummary;
  point: BenchmarkPoint | null;
}

/** The answer of `POST /api/benchmark`: the run as it begins, and the state view. */
export interface BenchmarkStartAnswer extends StateView {
  run: BenchmarkRunSummary;
}

/** The answer of `GET /api/benchmark/preflight`: the three checks, or none when the benchmark is not available. */
export interface BenchmarkPreflightAnswer {
  checks: BenchmarkCheck[];
}

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

// ---- Faults (SIM-12) ----
// The routes under `/api/faults` of the simulator (`apps/simulator/src/faults.ts` has the settings and their limits). The state
// side (`FaultsSnapshot`, `FaultScope`, `MalformedKind`, `FaultEffectView`) is above, next to the engine snapshot.

/** The faults that act on each message of a device; link loss acts on the connection and a burst is a one-shot. */
export type SwitchKind = 'drop' | 'duplicate' | 'delay' | 'reorder' | 'malformed';

/** What `PUT /api/faults/:kind` takes. */
export type FaultKind = SwitchKind | 'link-loss';

/** The body of `PUT /api/faults/:kind`, by kind. */
export interface FaultBodies {
  drop: { percent: number };
  duplicate: { percent: number };
  delay: { delayMs: number; jitterMs: number };
  reorder: { window: number };
  malformed: { percent: number; kinds: MalformedKind[] };
  /** Without `forS` the link stays down until it is restored. */
  'link-loss': { forS?: number };
}

/** The answer of `POST /api/faults/burst`: the state, and how many messages the broker took or refused. */
export interface BurstAnswer extends StateView {
  sent: number;
  failed: number;
}

/**
 * The answer of `POST /api/messages/:id/republish`: the state, and the message as it went out again (a new `id`, the same
 * `seq`, `ts` and payload, tagged `republish`).
 */
export interface RepublishAnswer extends StateView {
  message: PublishedMessage;
}

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
  'benchmark',
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

// ---- The twin (SIM-17) ----
// A manual mirror of `TwinLayoutView` and its parts in `apps/simulator/src/twin-layout.ts`. `fixtures/twin-layout.json` is a
// trimmed `GET /api/twin-layout` body; the simulator's own tests check the real file and the route.

/** Where the copy of the command center's campus came from; the simulator does not check it against that repository. */
export interface TwinSource {
  repository: string;
  commit: string;
  files: string[];
  /** The day the copy was compared with the source, `YYYY-MM-DD`. */
  checkedOn: string;
}

/** The site boundary: a rounded rectangle, edges in metres east and north of `siteCenter`. */
export interface TwinBoundary {
  west: number;
  east: number;
  south: number;
  north: number;
  radius: number;
}

/** A zone as the command center's seed describes it; `use` and `heightM` are a building's only. */
export interface TwinZone {
  code: string;
  name: string;
  kind: string;
  use?: string;
  heightM?: number;
  /** [east, north] metres from the site centre. */
  at: [number, number];
  /** [width, depth] metres. */
  size: [number, number];
}

/** A device of the simulator's registry and where it stands; `illustrative` is a guess made by hand inside its zone. */
export interface TwinDevice {
  id: string;
  zone: string;
  at: [number, number];
  elevationM: number;
  placement: 'illustrative' | 'surveyed';
}

/** An asset of the command center's catalogue, which the simulator does not play. */
export interface TwinAsset {
  code: string;
  name: string;
  class: string;
  zone: string;
  at: [number, number];
  elevationM: number;
  simulated: false;
}

export interface TwinLayout {
  source: TwinSource;
  /** [longitude, latitude] of the origin of every position. */
  siteCenter: [number, number];
  boundary: TwinBoundary;
  zones: TwinZone[];
  devices: TwinDevice[];
  catalogue: TwinAsset[];
}

/** Which devices of the registry the layout places; `placed` and `unplaced` together are the registry. */
export interface TwinPlacement {
  placed: string[];
  unplaced: { id: string; reason: string }[];
  /** Devices the layout places that the registry does not have. */
  orphans: string[];
}

/** The answer of `GET /api/twin-layout`: a `200` also when the layout cannot be used (`available: false`, with the reason). */
export interface TwinLayoutView {
  available: boolean;
  reason: string | null;
  layout: TwinLayout | null;
  placement: TwinPlacement;
}

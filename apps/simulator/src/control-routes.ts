import { METRIC_NAMES, type MetricName } from '@itp/telemetry-contract';
import { STATUS_CODES } from 'node:http';
import { type AlertCause, alertCause, parseScenarioRun } from './alert-cause.ts';
import type { IngestAlert, ObservedAlert } from './alert-observer.ts';
import {
  BenchmarkBusyError,
  type BenchmarkRun,
  type BenchmarkSummary,
  BenchmarkUnavailableError,
  parseBenchmarkStart,
  PreflightFailedError,
} from './benchmark-run.ts';
import type { BrokerState } from './broker-link.ts';
import {
  type AlertsFeed,
  type AlertsPage,
  type AlertsPageQuery,
  IngestReadError,
  type IngestState,
  type MetricsFeed,
} from './ingest-poller.ts';
import type { DeviceState, Engine, EngineSnapshot, PublishedMessage } from './engine.ts';
import type { FaultEffect, FaultEffectView } from './fault-effect.ts';
import {
  type FaultConfigs,
  FaultConflictError,
  FAULT_KINDS,
  type FaultKind,
  parseBurst,
  parseFaultConfig,
  parseScope,
  type SwitchKind,
} from './faults.ts';
import { type ObservationStore, PAGE_MAX } from './observation-store.ts';
import type { RulesView } from './rules-source.ts';
import { lengthS, parseAnomalies, type ScenarioDocument } from './scenario-document.ts';
import { type Expected, expectedAlerts, MAX_WALK_TICKS } from './scenario-expectations.ts';
import type {
  LibraryEntry,
  RejectedScenario,
  RemoveResult,
  SaveResult,
  ScenarioLibrary,
} from './scenario-library.ts';
import {
  ScenarioConflictError,
  type ReplacedRun,
  type ScenarioRunView,
  type ScenarioRuns,
} from './scenario-runs.ts';
import {
  type Anomaly,
  type AnomalyShape,
  type DeviceSpec,
  type MetricProfile,
  profilesOf,
} from './signals.ts';
import type { TwinLayoutView } from './twin-layout.ts';

/** A request, after the HTTP layer has checked the headers and parsed the body. */
export interface RouteRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  /** The parsed JSON body; `undefined` when there was none. */
  body: unknown;
}

export interface RouteResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** An answer with a status. Thrown by the checks, turned into the error envelope by the router. */
export class HttpError extends Error {
  readonly status: number;
  /** Fields added to the error body beside `statusCode`, `error` and `message` (the `409` of a run names its conflicts). */
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

/** The error body of ingest's API, so one client reads both: `statusCode`, `error`, `message`. */
export function errorBody(status: number, message: string) {
  return { statusCode: status, error: STATUS_CODES[status] ?? 'Error', message };
}

export interface RoutesContext {
  engine: Engine;
  /** The devices as loaded from the registry (the engine's snapshot has only their state). */
  devices: DeviceSpec[];
  /** Every scenario that can be run: the built-ins, the custom ones read at start and the ones imported since. */
  library: ScenarioLibrary;
  /** The scenarios Studio started; it records its own observations. */
  runs: ScenarioRuns;
  store: ObservationStore;
  ingest: {
    state(): IngestState;
    alerts(): AlertsFeed;
    metrics(): MetricsFeed;
    /** One page of ingest's alerts, with its `X-Next-Cursor`; throws `IngestReadError`. */
    alertsPage(query: AlertsPageQuery): Promise<AlertsPage>;
    /** One alert as Studio saw it, or `undefined` when it never tracked it. */
    observedAlert(id: string): ObservedAlert | undefined;
  };
  config: { ingestUrl: string; consoleUrl: string | null };
  /** The simulator's own connection to the MQTT broker. */
  broker: { state(): BrokerState };
  /** The threshold rules read at boot (or why there are none); they do not change while the process runs. */
  rules: RulesView;
  /** The twin layout read at boot (or why there is none) and which devices it places; it does not change while the process runs. */
  twinLayout: TwinLayoutView;
  /** When the faults began and what ingest's counters said then, for the effect panel. */
  effect: FaultEffect;
  /** The publish log: the last `capacity` messages the broker acknowledged and the stream forwarded, newest last. */
  messages: { find(id: number): PublishedMessage | undefined; capacity: number };
  /** The benchmark run, or the account of why there is none (`available: false`). */
  benchmark: BenchmarkRun;
}

/** Everything a client needs to draw the current state; the answer to every command. */
export interface StateView {
  engine: EngineSnapshot;
  devices: DeviceSpec[];
  /** The names in the library; the library read (`GET /api/scenarios`) has the rest. */
  scenarios: string[];
  /** The scenarios that are playing now; elapsed time is `engine.elapsedS − offsetS`. */
  runs: ScenarioRunView[];
  ingest: IngestState;
  /** Whether this simulator is connected to the broker (ingest's own view is `ingest.broker`). */
  broker: BrokerState;
  alerts: AlertsFeed;
  metrics: MetricsFeed;
  /** The rules ingest applies, as the charts and range bars of Studio draw them. */
  rules: RulesView;
  /** Baseline, noise and daily swing of every metric of every device, by device id (read-only). */
  profiles: Record<string, Partial<Record<MetricName, MetricProfile>>>;
  config: { ingestUrl: string; consoleUrl: string | null; intervalMs: number; simulated: boolean };
  /** Id of the newest observation, where a timeline starts paging back from. */
  observationCursor: number;
  /** The session of the effect panel (`fault-effect.ts`); `null` until a fault has been switched on. */
  faultEffect: FaultEffectView | null;
  /** The benchmark without its series (`GET /api/benchmark` has them): what it needs, whether one is running, the last runs. */
  benchmark: BenchmarkSummary;
}

/**
 * An alert of `GET /api/alerts`: what ingest says, plus what only Studio knows. `observed` is empty and
 * `preexisting` true for an alert Studio never tracked (older than what it read, or from before it started);
 * `cause` is a scenario Studio started, only when the evidence matches (`alert-cause.ts`), else `null`.
 */
export interface PagedAlert extends IngestAlert {
  preexisting: boolean;
  observed: ObservedAlert['observed'];
  cause: AlertCause | null;
}

/** The most alerts ingest returns in a page (`docs/api.md`). */
const ALERTS_PAGE_MAX = 200;
/** The longest `before` ingest accepts (`alerts.dto.ts`); a longer one is refused here without asking. */
const CURSOR_MAX_LENGTH = 200;

const unobserved = (): ObservedAlert['observed'] => ({
  openedAt: null,
  clearedAt: null,
  delivered: { opened: null, cleared: null },
  incident: null,
});

/** The profiles depend only on the registry, which does not change while the process runs. */
const profileCache = new WeakMap<DeviceSpec[], StateView['profiles']>();

function profilesFor(devices: DeviceSpec[]): StateView['profiles'] {
  let profiles = profileCache.get(devices);
  if (!profiles) {
    profiles = profilesOf(devices);
    profileCache.set(devices, profiles);
  }
  return profiles;
}

/** One scenario as `GET /api/scenarios` gives it: the document plus what only the simulator can say about it now. */
export interface ScenarioItem {
  name: string;
  description: string;
  source: LibraryEntry['source'];
  /** Imported during this session: it is not in the folder and ends with the process. */
  imported: boolean;
  anomalies: Anomaly[];
  /** Seconds from the scenario start to the end of its last anomaly. */
  lengthS: number;
  /** Devices that running it would start, in the order it uses them, with the state they are in now. */
  needsStart: { deviceId: string; state: Exclude<DeviceState, 'running'> }[];
  /** When it was last run in this session (ISO 8601), or `null`. */
  lastRunAt: string | null;
  running: boolean;
  expected: Expected;
}

/**
 * The answer of `POST /api/expectations`: what the rules should do with a list of anomalies that is in no scenario (the
 * Lab's fault being configured), worked out exactly as the library read does it for a scenario. Times are seconds from now.
 */
export interface ExpectationPreview {
  expected: Expected;
  /** Devices the anomalies name that are not running now, with the state they are in (the library item's `needsStart`). */
  needsStart: ScenarioItem['needsStart'];
  /** The engine's publish interval, which the tolerance of the expected times is measured in. */
  intervalMs: number;
}

/** The most anomalies one preview takes: a fault on every device of a registry of this size. */
export const PREVIEW_MAX_ANOMALIES = 100;

export interface ScenarioLibraryView {
  scenarios: ScenarioItem[];
  /** Files and built-ins that were not kept, with the reason. */
  rejected: RejectedScenario[];
  /** The engine's publish interval, which the tolerance of the expected times is measured in. */
  intervalMs: number;
}

export function buildStateView(context: RoutesContext): StateView {
  const engine = context.engine.snapshot();
  return {
    engine,
    devices: context.devices,
    scenarios: context.library.names(),
    runs: context.runs.active(),
    ingest: context.ingest.state(),
    broker: context.broker.state(),
    alerts: context.ingest.alerts(),
    metrics: context.ingest.metrics(),
    rules: context.rules,
    profiles: profilesFor(context.devices),
    config: {
      ingestUrl: context.config.ingestUrl,
      consoleUrl: context.config.consoleUrl,
      intervalMs: engine.intervalMs,
      simulated: engine.simulated,
    },
    observationCursor: context.store.latestId(),
    faultEffect: context.effect.view(),
    benchmark: context.benchmark.view(),
  };
}

/** The `:id`, `:metric` and `:name` of a path; a handler reads only the ones its path has. */
type Params = Record<'id' | 'metric' | 'name' | 'kind', string>;

interface Route {
  method: string;
  segments: string[];
  /** A path that fits the segments but not this (a `:kind` that is no fault) is not this route's, and gets the `404` of no route. */
  accepts?(params: Params): boolean;
  run(params: Params, request: RouteRequest): RouteResponse | Promise<RouteResponse>;
}

const ok = (body: unknown, headers?: Record<string, string>): RouteResponse => ({
  status: 200,
  body,
  ...(headers ? { headers } : {}),
});

function bodyObject(request: RouteRequest): Record<string, unknown> {
  const body = request.body ?? {};
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

function numberField(body: Record<string, unknown>, name: string): number {
  const value = body[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `"${name}" must be a finite number`);
  }
  return value;
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || value === '') {
    throw new HttpError(400, `"${name}" must be a non-empty string`);
  }
  return value;
}

function integerParam(query: URLSearchParams, name: string, min: number, max: number) {
  const text = query.get(name);
  if (text === null) return undefined;
  const value = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(400, `"${name}" must be an integer from ${min} to ${max}`);
  }
  return value;
}

function statusParam(query: URLSearchParams): AlertsPageQuery['status'] {
  const text = query.get('status');
  if (text === null) return undefined;
  if (text !== 'open' && text !== 'cleared') {
    throw new HttpError(400, '"status" must be "open" or "cleared"');
  }
  return text;
}

/** The cursor is ingest's to read: only its presence and length are checked here. */
function cursorParam(query: URLSearchParams): string | undefined {
  const text = query.get('before');
  if (text === null) return undefined;
  if (text === '' || text.length > CURSOR_MAX_LENGTH) {
    throw new HttpError(
      400,
      `"before" must be the X-Next-Cursor of a previous page (1 to ${CURSOR_MAX_LENGTH} characters)`,
    );
  }
  return text;
}

function matchSegments(template: string[], actual: string[]): Params | undefined {
  if (template.length !== actual.length) return undefined;
  const params: Record<string, string> = {};
  for (const [i, part] of template.entries()) {
    const value = actual[i] as string;
    if (part.startsWith(':')) {
      try {
        params[part.slice(1)] = decodeURIComponent(value);
      } catch {
        throw new HttpError(400, 'The path is not valid percent-encoding');
      }
    } else if (part !== value) {
      return undefined;
    }
  }
  return params as Params;
}

function toErrorResponse(error: unknown): RouteResponse {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { ...errorBody(error.status, error.message), ...error.details },
    };
  }
  // The engine rejects what it cannot play with an Error or a RangeError and a message: that is the
  // caller's input. Anything else (a TypeError, something thrown that is not an Error) is our bug.
  if (error instanceof FaultConflictError) {
    return { status: 409, body: errorBody(409, error.message) };
  }
  if (error instanceof Error && !(error instanceof TypeError)) {
    return { status: 400, body: errorBody(400, error.message) };
  }
  return { status: 500, body: errorBody(500, 'Internal error') };
}

/**
 * The commands and reads of the control API, with no socket in them: a request in, a response out.
 * That is what lets the tests run them against an engine on a manual clock.
 *
 * Checks come before the engine is called, so a bad request changes nothing and each failure has
 * its own status: `404` for something that does not exist, `400` for a value that cannot be used,
 * `409` for a command the engine cannot run in its current mode.
 */
/**
 * How the control API says the library's refusals. A document that is wrong in itself (including one that would not fit a
 * file) is `400`; a request that is right but meets the state of the library is `409`; a folder that cannot be written is
 * the environment's fault, not the caller's, so `500` with the reason.
 */
const SAVE_STATUS: Record<Extract<SaveResult, { ok: false }>['kind'], number> = {
  invalid: 400,
  'too-large': 400,
  'built-in': 409,
  full: 409,
  'file-exists': 409,
  unwritable: 500,
};

const REMOVE_STATUS: Record<Extract<RemoveResult, { ok: false }>['kind'], number> = {
  'not-found': 404,
  'built-in': 409,
  unwritable: 500,
};

export function createRoutes(context: RoutesContext) {
  const { engine } = context;
  const view = () => buildStateView(context);

  function findDevice(id: string): DeviceSpec {
    const device = context.devices.find((d) => d.id === id);
    if (!device) throw new HttpError(404, `Unknown device "${id}"`);
    return device;
  }

  /**
   * A command that publishes, schedules publishing or releases held messages is refused while a benchmark runs: it would add to
   * the run that is being measured. Settings of a paused fleet, reads and the benchmark's own Stop stay open. The server refuses
   * here, whatever the page disabled.
   */
  function refuseWhileBenchmarking(): void {
    if (context.benchmark.running)
      throw new HttpError(409, 'A benchmark is running; stop it first');
  }

  function checkMetric(device: DeviceSpec, metric: string): MetricName {
    if (!METRIC_NAMES.includes(metric as MetricName)) {
      throw new HttpError(400, `Unknown metric "${metric}"`);
    }
    if (!device.metrics.includes(metric as MetricName)) {
      throw new HttpError(400, `Device "${device.id}" has no metric "${metric}"`);
    }
    return metric as MetricName;
  }

  const routes: Route[] = [];
  const on = (method: string, template: string, run: Route['run'], accepts?: Route['accepts']) =>
    routes.push({
      method,
      segments: template.slice(1).split('/'),
      run,
      ...(accepts ? { accepts } : {}),
    });

  on('GET', '/api/state', () => ok(view()));

  // Static data for the twin page, not part of the state: ten kilobytes that only that page asks for. An unusable layout is
  // still a 200 (`available: false` and the reason), the way the rules are in the state, because Topology is the fallback.
  on('GET', '/api/twin-layout', () => ok(context.twinLayout));

  on('GET', '/api/observations', (_params, request) => {
    const before = integerParam(request.query, 'before', 1, Number.MAX_SAFE_INTEGER);
    const limit = integerParam(request.query, 'limit', 1, PAGE_MAX);
    const page = context.store.page({ before, limit });
    return ok(
      page.events,
      page.next === undefined ? undefined : { 'X-Next-Cursor': String(page.next) },
    );
  });

  on('GET', '/api/alerts', async (_params, request) => {
    const status = statusParam(request.query);
    const limit = integerParam(request.query, 'limit', 1, ALERTS_PAGE_MAX);
    const before = cursorParam(request.query);

    let page: AlertsPage;
    try {
      page = await context.ingest.alertsPage({
        ...(status !== undefined ? { status } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(before !== undefined ? { before } : {}),
      });
    } catch (error) {
      if (error instanceof IngestReadError) {
        // Ingest's own refusal is the caller's request; anything else is ingest not giving a page.
        throw new HttpError(error.kind === 'refused' ? 400 : 502, error.message);
      }
      throw error;
    }

    const runs = context.store
      .byKind('scenario-run')
      .map(parseScenarioRun)
      .filter((run) => run !== undefined);
    const simulated = engine.snapshot().simulated;
    const alerts = page.alerts.map((alert): PagedAlert => {
      const tracked = context.ingest.observedAlert(alert.id);
      return {
        // The page is fresher than anything Studio kept, so its fields win; Studio adds only its own.
        ...alert,
        preexisting: tracked?.preexisting ?? true,
        observed: tracked?.observed ?? unobserved(),
        cause: alertCause(alert, runs, { simulated }),
      };
    });
    return ok(alerts, page.next === null ? undefined : { 'X-Next-Cursor': page.next });
  });

  for (const [action, run] of [
    ['start', (id: string) => engine.startDevice(id)],
    ['pause', (id: string) => engine.pauseDevice(id)],
    ['stop', (id: string) => engine.stopDevice(id)],
  ] as const) {
    on('POST', `/api/devices/:id/${action}`, ({ id }) => {
      if (action === 'start') refuseWhileBenchmarking();
      run(findDevice(id).id);
      return ok(view());
    });
  }

  on('PUT', '/api/devices/:id/interval', ({ id }, request) => {
    const device = findDevice(id);
    const body = bodyObject(request);
    if (!('intervalMs' in body)) {
      throw new HttpError(400, '"intervalMs" is required: milliseconds, or null for the default');
    }
    engine.setDeviceInterval(
      device.id,
      body.intervalMs === null ? undefined : numberField(body, 'intervalMs'),
    );
    return ok(view());
  });

  on('PUT', '/api/devices/:id/holds/:metric', ({ id, metric }, request) => {
    const device = findDevice(id);
    const name = checkMetric(device, metric);
    engine.holdValue(device.id, name, numberField(bodyObject(request), 'value'));
    return ok(view());
  });

  on('DELETE', '/api/devices/:id/holds/:metric', ({ id, metric }) => {
    const device = findDevice(id);
    engine.releaseValue(device.id, checkMetric(device, metric));
    return ok(view());
  });

  on('GET', '/api/anomalies', () => ok({ anomalies: engine.snapshot().anomalies }));

  on('POST', '/api/anomalies', (_params, request) => {
    const body = bodyObject(request);
    const device = findDevice(stringField(body, 'deviceId'));
    const metric = checkMetric(device, stringField(body, 'metric'));
    if (body.startAt !== undefined && body.startIn !== undefined) {
      throw new HttpError(400, 'Give "startAt" or "startIn", not both');
    }
    const startAt =
      body.startAt !== undefined
        ? numberField(body, 'startAt')
        : engine.snapshot().elapsedS +
          (body.startIn !== undefined ? numberField(body, 'startIn') : 0);
    const anomaly: Anomaly = {
      deviceId: device.id,
      metric,
      value: numberField(body, 'value'),
      startAt,
      duration: numberField(body, 'duration'),
    };
    if (body.shape !== undefined) anomaly.shape = stringField(body, 'shape') as AnomalyShape;
    const id = engine.addAnomaly(anomaly);
    return { status: 201, body: { id, ...view() } };
  });

  on('DELETE', '/api/anomalies/:id', ({ id }) => {
    if (!engine.removeAnomaly(id)) throw new HttpError(404, `Unknown anomaly "${id}"`);
    return ok(view());
  });

  /**
   * What a scenario would need and do, for the library and for the preview alike, so the two cannot drift: the devices it would
   * start, and the alerts the rules should raise. Worked out on every call: a device's own interval can change while the process runs.
   */
  function expectationFor(
    scenario: ScenarioDocument,
    engineState: EngineSnapshot,
    limits: { maxTotalTicks?: number } = {},
  ): Pick<ScenarioItem, 'needsStart' | 'expected'> {
    const devices = new Map(engineState.devices.map((device) => [device.id, device]));
    const needsStart: ScenarioItem['needsStart'] = [];
    for (const deviceId of new Set(scenario.anomalies.map((anomaly) => anomaly.deviceId))) {
      const state = devices.get(deviceId)?.state;
      if (state !== undefined && state !== 'running') needsStart.push({ deviceId, state });
    }
    const expected = expectedAlerts(scenario, {
      devices: context.devices,
      rules: context.rules,
      intervalMs: engineState.intervalMs,
      intervalMsOf: (deviceId) => devices.get(deviceId)?.intervalMs ?? engineState.intervalMs,
      needsStart: new Set(needsStart.map((need) => need.deviceId)),
      baseMs: engineState.nowMs,
      ...limits,
    });
    return { needsStart, expected };
  }

  function scenarioItem(entry: LibraryEntry, engineState: EngineSnapshot): ScenarioItem {
    const { scenario } = entry;
    const { needsStart, expected } = expectationFor(scenario, engineState);
    return {
      name: scenario.name,
      description: scenario.description,
      source: entry.source,
      imported: entry.imported,
      anomalies: scenario.anomalies,
      lengthS: lengthS(scenario),
      needsStart,
      lastRunAt: context.runs.lastRunAt(scenario.name),
      running: context.runs.active().some((run) => run.scenario === scenario.name),
      expected,
    };
  }

  function findScenario(name: string): LibraryEntry {
    const entry = context.library.get(name);
    if (!entry) throw new HttpError(404, `Unknown scenario "${name}"`);
    return entry;
  }

  on('GET', '/api/scenarios', () => {
    const engineState = engine.snapshot();
    const body: ScenarioLibraryView = {
      scenarios: context.library.list().map((entry) => scenarioItem(entry, engineState)),
      rejected: context.library.rejected,
      intervalMs: engineState.intervalMs,
    };
    return ok(body);
  });

  // A POST because the body is a list that does not fit a query string; it changes nothing: no anomaly, no library entry, no
  // observation. It sees only the anomalies of the request, not the ones the engine already plays (the caller checks those).
  on('POST', '/api/expectations', (_params, request) => {
    const body = bodyObject(request);
    const extra = Object.keys(body).find((key) => key !== 'anomalies');
    if (extra !== undefined) {
      throw new HttpError(400, `"${extra}" is not a known field of the request`);
    }
    const list = parseAnomalies(body.anomalies, {
      devices: context.devices,
      max: PREVIEW_MAX_ANOMALIES,
    });
    if (!list.ok) throw new HttpError(400, list.reason);

    const engineState = engine.snapshot();
    const scenario: ScenarioDocument = {
      name: 'preview',
      description: '',
      anomalies: list.anomalies,
    };
    const { needsStart, expected } = expectationFor(scenario, engineState, {
      maxTotalTicks: MAX_WALK_TICKS,
    });
    const answer: ExpectationPreview = { expected, needsStart, intervalMs: engineState.intervalMs };
    return ok(answer);
  });

  on('POST', '/api/scenarios/import', (_params, request) => {
    const result = context.library.import(request.body);
    if (!result.ok) throw new HttpError(result.kind === 'invalid' ? 400 : 409, result.reason);
    return {
      status: 201,
      body: { scenario: scenarioItem(result.entry, engine.snapshot()), ...view() },
    };
  });

  // Saving writes `<name>.json` in the scenarios folder (the first command that changes the disk; see ADR-0011). The name
  // is the path's and the document's at once, so that a URL never says one thing and the file another. A scenario that is
  // running is not changed: runs are found by name, and a stop of a scenario that is gone would be a 404.
  function refuseWhileRunning(name: string): void {
    if (context.runs.active().some((run) => run.scenario === name)) {
      throw new HttpError(409, `"${name}" is running; stop it first`);
    }
  }

  on('PUT', '/api/scenarios/:name', ({ name }, request) => {
    const body = bodyObject(request);
    if (body.name !== name) {
      throw new HttpError(
        400,
        `"name" in the body must be "${name}", the name in the path (a rename is a save under the new name, then a delete)`,
      );
    }
    refuseWhileRunning(name);
    const result = context.library.save(body);
    if (!result.ok) throw new HttpError(SAVE_STATUS[result.kind], result.reason);
    return {
      status: result.created ? 201 : 200,
      body: { scenario: scenarioItem(result.entry, engine.snapshot()), ...view() },
    };
  });

  on('DELETE', '/api/scenarios/:name', ({ name }) => {
    refuseWhileRunning(name);
    const result = context.library.remove(name);
    if (!result.ok) throw new HttpError(REMOVE_STATUS[result.kind], result.reason);
    return ok(view());
  });

  on('POST', '/api/scenarios/:name/run', ({ name }, request) => {
    refuseWhileBenchmarking();
    const entry = findScenario(name);
    const body = bodyObject(request);
    if (body.replace !== undefined && typeof body.replace !== 'boolean') {
      throw new HttpError(400, '"replace" must be true or false');
    }

    // All or nothing, and the presets are written for the start of a run: "20 s in" is 20 s from now.
    let outcome: { run: ScenarioRunView; replaced: ReplacedRun[] };
    try {
      outcome = context.runs.run(entry.scenario, { replace: body.replace === true });
    } catch (error) {
      if (error instanceof ScenarioConflictError) {
        throw new HttpError(409, error.message, { conflicts: error.conflicts });
      }
      throw error;
    }
    const { run, replaced } = outcome;
    return ok({
      runId: run.id,
      anomalyIds: run.anomalyIds,
      startedDevices: run.startedDevices,
      replaced,
      ...view(),
    });
  });

  on('POST', '/api/scenarios/:name/stop', ({ name }) => {
    findScenario(name);
    if (!context.runs.stop(name)) throw new HttpError(409, `"${name}" is not running`);
    return ok(view());
  });

  // Faults. Nothing here writes to disk: they change what this process sends, in memory, and end with it. The body is
  // checked with the same parsers the engine checks again, so that a refusal names the field; the effect session starts
  // after the command worked, from the counters read before it, so a refused command leaves no session behind.
  const isFaultKind = ({ kind }: Params) => (FAULT_KINDS as readonly string[]).includes(kind);

  /** The environment's fault, not the caller's: the connection could not be cut or restored. */
  async function linkAction<T>(what: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof FaultConflictError) throw error;
      throw new HttpError(
        500,
        `${what}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  on('PUT', '/api/faults/scope', (_params, request) => {
    const parsed = parseScope(
      request.body,
      context.devices.map((d) => d.id),
    );
    if (!parsed.ok) throw new HttpError(parsed.unknownDevice ? 404 : 400, parsed.reason);
    engine.setFaultScope(parsed.value);
    return ok(view());
  });

  on('POST', '/api/faults/burst', async (_params, request) => {
    refuseWhileBenchmarking();
    const parsed = parseBurst(request.body);
    if (!parsed.ok) throw new HttpError(400, parsed.reason);
    const feed = context.ingest.metrics();
    const result = await engine.burst(parsed.value.count);
    context.effect.ensureStarted(feed);
    return ok({ ...result, ...view() });
  });

  on('POST', '/api/faults/effect/reset', () => {
    context.effect.restart(context.ingest.metrics());
    return ok(view());
  });

  on(
    'PUT',
    '/api/faults/:kind',
    async ({ kind }, request) => {
      if (kind === 'link-loss') refuseWhileBenchmarking();
      const parsed = parseFaultConfig(kind as FaultKind, request.body);
      if (!parsed.ok) throw new HttpError(400, parsed.reason);
      const feed = context.ingest.metrics();
      if (kind === 'link-loss') {
        const { forS } = parsed.value as FaultConfigs['link-loss'];
        await linkAction('The link could not be cut', () => engine.cutLink({ forS }));
      } else {
        engine.setFault(kind as SwitchKind, parsed.value as FaultConfigs[SwitchKind]);
      }
      context.effect.ensureStarted(feed);
      return ok(view());
    },
    isFaultKind,
  );

  on(
    'DELETE',
    '/api/faults/:kind',
    async ({ kind }) => {
      if (kind === 'link-loss') refuseWhileBenchmarking();
      if (kind === 'link-loss') {
        await linkAction('The link could not be restored', () => engine.restoreLink());
      } else {
        engine.clearFault(kind as SwitchKind);
      }
      return ok(view());
    },
    isFaultKind,
  );

  on('DELETE', '/api/faults', async () => {
    // Clearing releases the messages that were held back, which are publishing.
    refuseWhileBenchmarking();
    await linkAction('Faults were cleared, but the link could not be restored', () =>
      engine.clearFaults(),
    );
    return ok(view());
  });

  on('POST', '/api/messages/:id/republish', async ({ id }) => {
    refuseWhileBenchmarking();
    const messageId = /^\d+$/.test(id) ? Number(id) : NaN;
    if (!Number.isSafeInteger(messageId) || messageId < 1) {
      throw new HttpError(400, '"id" must be a whole number of 1 or more');
    }
    const original = context.messages.find(messageId);
    if (!original) {
      throw new HttpError(
        404,
        `Message ${messageId} is not in the publish log; only the last ${context.messages.capacity} are kept`,
      );
    }
    const feed = context.ingest.metrics();
    let sent: PublishedMessage;
    try {
      sent = await engine.republish(original);
    } catch (error) {
      if (error instanceof FaultConflictError) throw error;
      // The broker did not take it: that is not the caller's input, which is why it is not the 400 of an Error.
      throw new HttpError(
        502,
        `The broker did not accept the message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    context.effect.ensureStarted(feed);
    return ok({ message: sent, ...view() });
  });

  // The benchmark. It publishes up to MAX_MESSAGES messages from a process of its own and writes their readings to the database
  // in `DATABASE_URL`, so a start needs `confirm: true`, passes the checks again here, and is refused while another is going.
  on('GET', '/api/benchmark', () => ok({ benchmark: context.benchmark.detail() }));

  on('GET', '/api/benchmark/preflight', async () =>
    ok({ checks: await context.benchmark.preflight() }),
  );

  on('POST', '/api/benchmark', async (_params, request) => {
    const parsed = parseBenchmarkStart(request.body);
    if (!parsed.ok) throw new HttpError(400, parsed.reason);
    try {
      const run = await context.benchmark.start(parsed.value);
      return ok({ run, ...view() });
    } catch (error) {
      if (error instanceof BenchmarkUnavailableError) throw new HttpError(503, error.message);
      if (error instanceof PreflightFailedError) {
        throw new HttpError(409, error.message, { checks: error.checks });
      }
      if (error instanceof BenchmarkBusyError) throw new HttpError(409, error.message);
      throw error;
    }
  });

  on('POST', '/api/benchmark/stop', async () => {
    if (!(await context.benchmark.stop())) throw new HttpError(409, 'No benchmark is running');
    return ok(view());
  });

  on('POST', '/api/reset', () => {
    refuseWhileBenchmarking();
    engine.reset();
    return ok(view());
  });

  on('POST', '/api/step', async () => {
    refuseWhileBenchmarking();
    if (!engine.snapshot().simulated) {
      throw new HttpError(
        409,
        'step needs the simulated clock; this engine runs on the wall clock',
      );
    }
    try {
      await engine.step();
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : 'The engine cannot step');
    }
    return ok(view());
  });

  return async function handle(request: RouteRequest): Promise<RouteResponse> {
    try {
      const segments = request.path.slice(1).split('/');
      const allowed = new Set<string>();
      for (const route of routes) {
        const params = matchSegments(route.segments, segments);
        if (!params || (route.accepts && !route.accepts(params))) continue;
        if (route.method === request.method) return await route.run(params, request);
        allowed.add(route.method);
      }
      if (allowed.size > 0) {
        return {
          status: 405,
          body: errorBody(405, `${request.method} is not allowed on ${request.path}`),
          headers: { Allow: [...allowed].join(', ') },
        };
      }
      throw new HttpError(404, `No such route: ${request.method} ${request.path}`);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

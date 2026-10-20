import { METRIC_NAMES, type MetricName } from '@itp/telemetry-contract';
import { STATUS_CODES } from 'node:http';
import {
  type AlertCause,
  alertCause,
  parseScenarioRun,
  type ScenarioRunAnomaly,
} from './alert-cause.ts';
import type { IngestAlert, ObservedAlert } from './alert-observer.ts';
import type { BrokerState } from './broker-link.ts';
import {
  type AlertsFeed,
  type AlertsPage,
  type AlertsPageQuery,
  IngestReadError,
  type IngestState,
  type MetricsFeed,
} from './ingest-poller.ts';
import type { Engine, EngineSnapshot } from './engine.ts';
import { type ObservationDraft, type ObservationStore, PAGE_MAX } from './observation-store.ts';
import type { RulesView } from './rules-source.ts';
import {
  type Anomaly,
  type AnomalyShape,
  type DeviceSpec,
  type MetricProfile,
  parseAnomaly,
  profilesOf,
} from './signals.ts';

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

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
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
  /** Preset anomalies by name, in the `--anomaly` format (`scenarios.ts`). */
  scenarios: Record<string, string[]>;
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
  /** Stores an observation made by a command (a scenario run) and tells the stream about it. */
  record(draft: ObservationDraft): void;
}

/** Everything a client needs to draw the current state; the answer to every command. */
export interface StateView {
  engine: EngineSnapshot;
  devices: DeviceSpec[];
  scenarios: string[];
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

export function buildStateView(context: RoutesContext): StateView {
  const engine = context.engine.snapshot();
  return {
    engine,
    devices: context.devices,
    scenarios: Object.keys(context.scenarios),
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
  };
}

/** The `:id`, `:metric` and `:name` of a path; a handler reads only the ones its path has. */
type Params = Record<'id' | 'metric' | 'name', string>;

interface Route {
  method: string;
  segments: string[];
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
    return { status: error.status, body: errorBody(error.status, error.message) };
  }
  // The engine rejects what it cannot play with an Error or a RangeError and a message: that is the
  // caller's input. Anything else (a TypeError, something thrown that is not an Error) is our bug.
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
export function createRoutes(context: RoutesContext) {
  const { engine } = context;
  const view = () => buildStateView(context);

  function findDevice(id: string): DeviceSpec {
    const device = context.devices.find((d) => d.id === id);
    if (!device) throw new HttpError(404, `Unknown device "${id}"`);
    return device;
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
  const on = (method: string, template: string, run: Route['run']) =>
    routes.push({ method, segments: template.slice(1).split('/'), run });

  on('GET', '/api/state', () => ok(view()));

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

  on('GET', '/api/scenarios', () =>
    ok({
      scenarios: Object.entries(context.scenarios).map(([name, specs]) => ({
        name,
        anomalies: specs.map(parseAnomaly),
      })),
    }),
  );

  on('POST', '/api/scenarios/:name/run', ({ name }) => {
    const specs = Object.hasOwn(context.scenarios, name) ? context.scenarios[name] : undefined;
    if (!specs) throw new HttpError(404, `Unknown scenario "${name}"`);

    // The presets are written for the start of a run: "20 s in". Run now, they start 20 s from now.
    const offsetS = engine.snapshot().elapsedS;
    const anomalyIds: string[] = [];
    const anomalies: ScenarioRunAnomaly[] = [];
    try {
      for (const spec of specs) {
        const anomaly = parseAnomaly(spec);
        const startAt = anomaly.startAt + offsetS;
        const id = engine.addAnomaly({ ...anomaly, startAt });
        anomalyIds.push(id);
        anomalies.push({
          id,
          deviceId: anomaly.deviceId,
          metric: anomaly.metric,
          startAt,
          duration: anomaly.duration,
        });
      }
    } catch (error) {
      // All or nothing: a preset that names a device this registry does not have adds nothing.
      for (const id of anomalyIds) engine.removeAnomaly(id);
      throw error;
    }
    // The anomalies are kept with the run because the engine forgets them on a reset, and the cause of an
    // alert (`GET /api/alerts`) is worked out from the run, not from what the engine holds now.
    context.record({ kind: 'scenario-run', data: { name, anomalyIds, offsetS, anomalies } });
    return ok({ anomalyIds, ...view() });
  });

  on('POST', '/api/reset', () => {
    engine.reset();
    return ok(view());
  });

  on('POST', '/api/step', async () => {
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
        if (!params) continue;
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

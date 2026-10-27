import type {
  AlertsPage,
  Anomaly,
  AnomalyAnswer,
  AnomalyRequest,
  BenchmarkCheck,
  BenchmarkDetail,
  BenchmarkPreflightAnswer,
  BenchmarkStartAnswer,
  BurstAnswer,
  FaultBodies,
  FaultKind,
  FaultScope,
  ExpectationPreview,
  ImportAnswer,
  ObservationEvent,
  ObservationsPage,
  PagedAlert,
  RepublishAnswer,
  RunAnswer,
  RunConflict,
  SaveAnswer,
  ScenarioItem,
  ScenarioLibraryView,
  StateView,
  TwinLayoutView,
} from './types';

/** A request the simulator refused or could not answer. `status` is 0 when it did not answer at all. */
export class ApiError extends Error {
  readonly status: number;
  /** The parsed JSON of a refusal (the envelope and what the simulator added to it), or `undefined`. */
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Reads the JSON of a reply. A refusal of the control API is `{ statusCode, error, message }`
 * (the envelope of ingest's API): its message is what the error carries.
 */
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text === '' ? undefined : JSON.parse(text);
  } catch {
    throw new ApiError(
      response.status,
      `The simulator answered with something that is not JSON (HTTP ${response.status})`,
    );
  }
  if (!response.ok) {
    const message = (body as { message?: unknown } | undefined)?.message;
    throw new ApiError(
      response.status,
      typeof message === 'string' ? message : `HTTP ${response.status}`,
      body,
    );
  }
  return body;
}

function isStateView(body: unknown): body is StateView {
  if (typeof body !== 'object' || body === null) return false;
  const view = body as Record<string, unknown>;
  return ['engine', 'devices', 'ingest', 'broker', 'alerts', 'config'].every((key) => key in view);
}

/** Sends a request. An abort is passed on as it is; any other failure to get an answer is `status: 0`. */
async function send(url: string, init: RequestInit, options: RequestOptions): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  try {
    return await doFetch(url, {
      ...init,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Cannot reach the simulator');
  }
}

/**
 * Sends a request and reads the simulator's answer as a state view (the answer of `GET /api/state` and of every
 * command), plus whatever else `hasExtras` requires of it: a run also answers what it did, an import the scenario.
 */
async function fetchAnswer<T extends StateView>(
  url: string,
  init: RequestInit,
  options: RequestOptions,
  hasExtras: (body: Record<string, unknown>) => boolean = () => true,
): Promise<T> {
  const response = await send(url, init, options);
  const body = await readJson(response);
  if (!isStateView(body) || !hasExtras(body as unknown as Record<string, unknown>))
    throw new ApiError(
      response.status,
      'The simulator answered with a state Studio does not understand',
    );
  return body as T;
}

const fetchState = (url: string, init: RequestInit, options: RequestOptions) =>
  fetchAnswer<StateView>(url, init, options);

/** `GET /api/state`: everything the pages draw, in one reply. Commands answer with the same. */
export function getState(options: RequestOptions = {}): Promise<StateView> {
  return fetchState('/api/state', { headers: { Accept: 'application/json' } }, options);
}

/**
 * A command of the control API. The server accepts a command only as `Content-Type: application/json`
 * (a cross-site page cannot send that), so the header is always set, with or without a body. The answer is
 * the new state, which the caller puts in the store at once instead of waiting for the stream.
 */
function sendCommand(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<StateView> {
  return sendCommandFor<StateView>(method, path, body, options);
}

/** A command whose answer is the state and something more (`hasExtras` checks the something). */
function sendCommandFor<T extends StateView>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  options: RequestOptions,
  hasExtras?: (body: Record<string, unknown>) => boolean,
): Promise<T> {
  return fetchAnswer<T>(
    path,
    {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    options,
    hasExtras,
  );
}

export interface AlertsRequest {
  status?: 'open' | 'cleared';
  /** 1 to 200, as ingest allows. */
  limit?: number;
  /** A cursor taken from the `next` of a previous page. Never built by the caller. */
  before?: string;
}

function isPagedAlert(item: unknown): item is PagedAlert {
  if (typeof item !== 'object' || item === null) return false;
  const alert = item as Record<string, unknown>;
  return (
    typeof alert.id === 'string' &&
    typeof alert.deviceId === 'string' &&
    typeof alert.status === 'string' &&
    typeof alert.openedAt === 'string' &&
    typeof alert.observed === 'object' &&
    alert.observed !== null &&
    'cause' in alert
  );
}

/**
 * `GET /api/alerts`: one page of ingest's alerts, newest first, through the simulator (the browser cannot reach
 * ingest). The next page is asked for by sending `next` back as `before`; Studio never builds a cursor. A body that
 * is not the documented array fails loudly instead of rendering as an empty or half-empty list.
 */
export async function getAlerts(
  request: AlertsRequest = {},
  options: RequestOptions = {},
): Promise<AlertsPage> {
  const params = new URLSearchParams();
  if (request.status !== undefined) params.set('status', request.status);
  if (request.limit !== undefined) params.set('limit', String(request.limit));
  if (request.before !== undefined) params.set('before', request.before);
  const search = params.toString();

  const response = await send(
    `/api/alerts${search === '' ? '' : `?${search}`}`,
    { headers: { Accept: 'application/json' } },
    options,
  );
  const body = await readJson(response);
  if (!Array.isArray(body) || !body.every(isPagedAlert)) {
    throw new ApiError(
      response.status,
      'The simulator answered with alerts Studio does not understand',
    );
  }
  const next = response.headers.get('X-Next-Cursor');
  return { alerts: body, next: next === null || next === '' ? null : next };
}

const devicePath = (deviceId: string) => `/api/devices/${encodeURIComponent(deviceId)}`;

export const startDevice = (deviceId: string, options: RequestOptions = {}) =>
  sendCommand('POST', `${devicePath(deviceId)}/start`, undefined, options);

export const pauseDevice = (deviceId: string, options: RequestOptions = {}) =>
  sendCommand('POST', `${devicePath(deviceId)}/pause`, undefined, options);

export const stopDevice = (deviceId: string, options: RequestOptions = {}) =>
  sendCommand('POST', `${devicePath(deviceId)}/stop`, undefined, options);

/** Publish this often, in ms; `null` goes back to the engine's interval. A bad value is refused before any request. */
export function setDeviceInterval(
  deviceId: string,
  intervalMs: number | null,
  options: RequestOptions = {},
): Promise<StateView> {
  if (intervalMs !== null && (!Number.isFinite(intervalMs) || intervalMs <= 0)) {
    return Promise.reject(
      new ApiError(400, 'The interval must be a positive number of milliseconds'),
    );
  }
  return sendCommand('PUT', `${devicePath(deviceId)}/interval`, { intervalMs }, options);
}

/**
 * Publish exactly this value for the metric until it is released. Whether the value is inside the contract's
 * range is the caller's to check (Studio's controls do; the Faults page is where a value outside it is sent
 * on purpose), but a value that is not a finite number never leaves the browser.
 */
export function holdValue(
  deviceId: string,
  metric: string,
  value: number,
  options: RequestOptions = {},
): Promise<StateView> {
  if (!Number.isFinite(value)) {
    return Promise.reject(new ApiError(400, 'A held value must be a finite number'));
  }
  return sendCommand(
    'PUT',
    `${devicePath(deviceId)}/holds/${encodeURIComponent(metric)}`,
    { value },
    options,
  );
}

export const releaseValue = (deviceId: string, metric: string, options: RequestOptions = {}) =>
  sendCommand(
    'DELETE',
    `${devicePath(deviceId)}/holds/${encodeURIComponent(metric)}`,
    undefined,
    options,
  );

// ---- Scenarios ----

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isScenarioItem(item: unknown): item is ScenarioItem {
  if (!isObject(item)) return false;
  return (
    typeof item.name === 'string' &&
    typeof item.description === 'string' &&
    (item.source === 'built-in' || item.source === 'custom') &&
    typeof item.imported === 'boolean' &&
    Array.isArray(item.anomalies) &&
    typeof item.lengthS === 'number' &&
    Array.isArray(item.needsStart) &&
    'lastRunAt' in item &&
    typeof item.running === 'boolean' &&
    isObject(item.expected) &&
    typeof item.expected.available === 'boolean'
  );
}

/**
 * `GET /api/scenarios`: the whole scenario library with what a card is drawn from (the simulator pages nothing: the
 * page does). A body that is not the documented list fails loudly instead of rendering as an empty library.
 */
export async function getScenarios(options: RequestOptions = {}): Promise<ScenarioLibraryView> {
  const response = await send(
    '/api/scenarios',
    { headers: { Accept: 'application/json' } },
    options,
  );
  const body = await readJson(response);
  if (
    !isObject(body) ||
    !Array.isArray(body.scenarios) ||
    !body.scenarios.every(isScenarioItem) ||
    !Array.isArray(body.rejected) ||
    typeof body.intervalMs !== 'number'
  ) {
    throw new ApiError(
      response.status,
      'The simulator answered with scenarios Studio does not understand',
    );
  }
  return body as unknown as ScenarioLibraryView;
}

// ---- The twin (SIM-17) ----

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

function isTwinLayoutView(body: unknown): body is TwinLayoutView {
  if (!isObject(body) || typeof body.available !== 'boolean') return false;
  if (body.reason !== null && typeof body.reason !== 'string') return false;
  const { placement, layout } = body;
  if (
    !isObject(placement) ||
    !isStringList(placement.placed) ||
    !isStringList(placement.orphans) ||
    !Array.isArray(placement.unplaced) ||
    !placement.unplaced.every(
      (item) => isObject(item) && typeof item.id === 'string' && typeof item.reason === 'string',
    )
  ) {
    return false;
  }
  // A layout that is not available has none; one that is available carries what the scene draws from.
  if (layout === null) return !body.available;
  return (
    body.available &&
    isObject(layout) &&
    isObject(layout.source) &&
    isObject(layout.boundary) &&
    Array.isArray(layout.zones) &&
    Array.isArray(layout.devices) &&
    Array.isArray(layout.catalogue)
  );
}

/**
 * `GET /api/twin-layout`: the campus the twin draws and which devices it places. The simulator answers `200` also when it
 * cannot use its layout file (`available: false` and the reason), so only a simulator that does not know the route (`404`),
 * a body that is not the view, or no answer at all fails here.
 */
export async function getTwinLayout(options: RequestOptions = {}): Promise<TwinLayoutView> {
  const response = await send(
    '/api/twin-layout',
    { headers: { Accept: 'application/json' } },
    options,
  );
  if (response.status === 404) {
    throw new ApiError(404, 'This simulator is too old for the twin: it has no /api/twin-layout');
  }
  const body = await readJson(response);
  if (!isTwinLayoutView(body)) {
    throw new ApiError(
      response.status,
      'The simulator answered with a twin layout Studio does not understand',
    );
  }
  return body;
}

const scenarioPath = (name: string) => `/api/scenarios/${encodeURIComponent(name)}`;

/**
 * Runs a scenario from now. Without `replace` the simulator refuses (`409`) to play over an anomaly that is active or
 * coming on a device the scenario uses, and the `ApiError` carries the conflicts (`conflictsOf`); with it, what is in
 * the way is taken out first. The answer is the new state and what the run did.
 */
export function runScenario(
  name: string,
  request: { replace?: boolean } = {},
  options: RequestOptions = {},
): Promise<RunAnswer> {
  return sendCommandFor<RunAnswer>(
    'POST',
    `${scenarioPath(name)}/run`,
    request.replace === true ? { replace: true } : undefined,
    options,
    (body) =>
      typeof body.runId === 'string' &&
      Array.isArray(body.startedDevices) &&
      Array.isArray(body.replaced),
  );
}

/** Stops the run of a scenario; `409` from the simulator when it is not running. */
export const stopScenario = (name: string, options: RequestOptions = {}) =>
  sendCommand('POST', `${scenarioPath(name)}/stop`, undefined, options);

/**
 * Sends a scenario document to be kept for the session. The simulator checks it and refuses with the reason (the
 * `ApiError`'s message); nothing is checked here beyond its being JSON, which the caller has done.
 */
export function importScenario(
  document: unknown,
  options: RequestOptions = {},
): Promise<ImportAnswer> {
  return sendCommandFor<ImportAnswer>('POST', '/api/scenarios/import', document, options, (body) =>
    isScenarioItem(body.scenario),
  );
}

/**
 * Saves a custom scenario: the simulator validates the document like a file (the contract's ranges included), writes
 * `<name>.json` in its scenarios folder and answers with the card. The name in the path is the document's own, so the
 * two cannot disagree. A refusal is the simulator's: `400` with the field named, `409` for a built-in, a scenario that is
 * running, the 201st scenario or a file that was not loaded, `500` when the folder cannot be written; the `ApiError`
 * carries the status and the reason.
 */
export function saveScenario(
  document: { name: string },
  options: RequestOptions = {},
): Promise<SaveAnswer> {
  return sendCommandFor<SaveAnswer>('PUT', scenarioPath(document.name), document, options, (body) =>
    isScenarioItem(body.scenario),
  );
}

/** Removes a custom scenario and its file; `404` when there is none, `409` for a built-in or one that is running. */
export const deleteScenario = (name: string, options: RequestOptions = {}) =>
  sendCommand('DELETE', scenarioPath(name), undefined, options);

function isRunConflict(item: unknown): item is RunConflict {
  if (!isObject(item)) return false;
  const owned = (value: unknown) => value === null || typeof value === 'string';
  return (
    typeof item.deviceId === 'string' &&
    typeof item.anomalyId === 'string' &&
    owned(item.runId) &&
    owned(item.scenario)
  );
}

/**
 * What a refused run would have played over, or `null` when `error` is not that refusal (a `409` with a list of
 * conflicts). A `409` of another kind, such as "is not running", has none.
 */
export function conflictsOf(error: unknown): RunConflict[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const conflicts = isObject(error.body) ? error.body.conflicts : undefined;
  if (!Array.isArray(conflicts) || conflicts.length === 0 || !conflicts.every(isRunConflict)) {
    return null;
  }
  return conflicts;
}

// ---- Faults (SIM-12) ----

const faultPath = (kind: FaultKind) => `/api/faults/${encodeURIComponent(kind)}`;

/**
 * Switches a fault on, or changes its settings (`link-loss` cuts the simulator's connection to the broker). The simulator
 * checks the body again and refuses with the field named: `400`, or `409` for a link that is already down or that this process
 * cannot cut, or `500` when the cut fails; the `ApiError` carries the status and the sentence.
 */
export function setFault<K extends FaultKind>(
  kind: K,
  body: FaultBodies[K],
  options: RequestOptions = {},
): Promise<StateView> {
  return sendCommand('PUT', faultPath(kind), body, options);
}

/** Switches one fault off (`link-loss` restores the link). Harmless when it is not on. */
export const clearFault = (kind: FaultKind, options: RequestOptions = {}) =>
  sendCommand('DELETE', faultPath(kind), undefined, options);

/**
 * Which devices the switches and a burst act on. An empty selection is refused here, as the simulator refuses it: choosing
 * "Selected" with no device chosen yet must not turn into a request.
 */
export function setFaultScope(scope: FaultScope, options: RequestOptions = {}): Promise<StateView> {
  if (scope.mode === 'selected' && scope.deviceIds.length === 0) {
    return Promise.reject(new ApiError(400, 'A selection needs at least one device'));
  }
  return sendCommand('PUT', '/api/faults/scope', scope, options);
}

/**
 * Sends that many valid messages at once. The request lasts as long as the burst does. `409` while one is being sent, when the
 * engine is not started, when no device in scope is running or when the link is down; `400` for a count the devices in scope
 * cannot space within their interval.
 */
export function sendBurst(count: number, options: RequestOptions = {}): Promise<BurstAnswer> {
  if (!Number.isInteger(count) || count < 1) {
    return Promise.reject(new ApiError(400, 'A burst is a whole number of messages, 1 or more'));
  }
  return sendCommandFor<BurstAnswer>(
    'POST',
    '/api/faults/burst',
    { count },
    options,
    (body) => typeof body.sent === 'number' && typeof body.failed === 'number',
  );
}

/** Whether a value has what Studio reads of a message the simulator sent again. */
function isSentMessage(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === 'number' &&
    typeof message.seq === 'number' &&
    typeof message.payload === 'string'
  );
}

/**
 * Sends a message of the simulator's publish log again, byte for byte (the same topic, payload, `seq` and `ts`), outside
 * the faults, and answers with the state and the message as it went out (a new `id`). `404` when the message is no longer
 * in the last 200 (or was never forwarded to the stream), `409` while the link to the broker is down, `502` when the broker
 * refuses it, `400` for an `id` that is not a whole number of 1 or more.
 */
export function republishMessage(
  id: number,
  options: RequestOptions = {},
): Promise<RepublishAnswer> {
  if (!Number.isSafeInteger(id) || id < 1) {
    return Promise.reject(new ApiError(400, 'A message id is a whole number of 1 or more'));
  }
  return sendCommandFor<RepublishAnswer>(
    'POST',
    `/api/messages/${id}/republish`,
    undefined,
    options,
    (body) => isSentMessage(body.message),
  );
}

/**
 * Clear all faults: restores the link, switches every fault off and sends what delay and reorder were holding. The scope
 * stays. `500` (with the rest cleared) when the link cannot be restored.
 */
export const clearFaults = (options: RequestOptions = {}) =>
  sendCommand('DELETE', '/api/faults', undefined, options);

/** Begins the effect session again from the counters now ("Reset counters"). */
export const resetFaultEffect = (options: RequestOptions = {}) =>
  sendCommand('POST', '/api/faults/effect/reset', undefined, options);

// ---- The engine's clock commands, and the observation log (SIM-09) ----

/**
 * Moves the simulated clock forward by one publish interval and sends the tick that falls due. The simulator answers
 * `409` on the wall clock (which is what it runs on unless it was started with `--simulated-clock`) and when the engine
 * is not started; the `ApiError` carries its reason.
 */
export const stepEngine = (options: RequestOptions = {}) =>
  sendCommand('POST', '/api/step', undefined, options);

/** Clears every anomaly and held value and restarts the anomaly clock. Device states and intervals stay. */
export const resetEngine = (options: RequestOptions = {}) =>
  sendCommand('POST', '/api/reset', undefined, options);

export interface ObservationsRequest {
  /** Exclusive: only events older than this id. Taken from the `next` of a previous page, never built by the caller. */
  before?: number;
  /** 1 to 500, as the simulator allows. */
  limit?: number;
}

/**
 * A well-formed envelope. The `kind` is only checked to be text: a simulator newer than this page may record a kind it
 * does not know, and that event is shown as "Other" rather than failing the whole read.
 */
function isObservationEvent(item: unknown): item is ObservationEvent {
  return (
    isObject(item) &&
    Number.isInteger(item.id) &&
    typeof item.at === 'string' &&
    typeof item.kind === 'string' &&
    isObject(item.data)
  );
}

/**
 * `GET /api/observations`: one page of what the control server saw, newest first. The next page is asked for by sending
 * `next` back as `before`. A body that is not the documented array fails loudly instead of rendering as an empty log.
 */
export async function getObservations(
  request: ObservationsRequest = {},
  options: RequestOptions = {},
): Promise<ObservationsPage> {
  const params = new URLSearchParams();
  if (request.before !== undefined) params.set('before', String(request.before));
  if (request.limit !== undefined) params.set('limit', String(request.limit));
  const search = params.toString();

  const response = await send(
    `/api/observations${search === '' ? '' : `?${search}`}`,
    { headers: { Accept: 'application/json' } },
    options,
  );
  const body = await readJson(response);
  if (!Array.isArray(body) || !body.every(isObservationEvent)) {
    throw new ApiError(
      response.status,
      'The simulator answered with observations Studio does not understand',
    );
  }
  const cursor = response.headers.get('X-Next-Cursor');
  const next = cursor === null || cursor === '' ? null : Number(cursor);
  if (next !== null && !Number.isInteger(next)) {
    throw new ApiError(
      response.status,
      'The simulator answered with a cursor Studio does not understand',
    );
  }
  return { events: body, next };
}

// ---- The Lab: faults on the engine, and what the rules would do with them (SIM-10) ----

/**
 * Adds one anomaly to the engine. The simulator checks it (device, metric, a duration above 0) and refuses with the
 * reason, which the `ApiError` carries; it does not start a stopped device, and it does not look for another anomaly on
 * the same device and metric (the engine plays the first one that matches), so the caller checks that. The answer is the
 * new state and the id.
 */
export function addAnomaly(
  request: AnomalyRequest,
  options: RequestOptions = {},
): Promise<AnomalyAnswer> {
  return sendCommandFor<AnomalyAnswer>(
    'POST',
    '/api/anomalies',
    request,
    options,
    (body) => typeof body.id === 'string',
  );
}

/** Removes an anomaly by the id `addAnomaly` gave; `404` from the simulator when it is gone already. */
export const removeAnomaly = (id: string, options: RequestOptions = {}) =>
  sendCommand('DELETE', `/api/anomalies/${encodeURIComponent(id)}`, undefined, options);

/**
 * `POST /api/expectations`: what the rules should do with these anomalies, times in seconds from now. It changes
 * nothing on the simulator (a `POST` only because the body is a list). A refusal carries the reason ("anomalies[1]
 * overlaps anomalies[0] on …"); a body that is not the documented answer fails loudly.
 */
export async function getExpected(
  anomalies: readonly Anomaly[],
  options: RequestOptions = {},
): Promise<ExpectationPreview> {
  const response = await send(
    '/api/expectations',
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ anomalies }),
    },
    options,
  );
  const body = await readJson(response);
  if (
    !isObject(body) ||
    !isObject(body.expected) ||
    typeof body.expected.available !== 'boolean' ||
    !Array.isArray(body.needsStart) ||
    typeof body.intervalMs !== 'number'
  ) {
    throw new ApiError(
      response.status,
      'The simulator answered with an expectation Studio does not understand',
    );
  }
  return body as unknown as ExpectationPreview;
}

// ---- The benchmark (SIM-15) ----

function isBenchmarkCheck(item: unknown): item is BenchmarkCheck {
  return (
    isObject(item) &&
    (item.id === 'ingest' || item.id === 'database' || item.id === 'fleet') &&
    typeof item.label === 'string' &&
    typeof item.ok === 'boolean' &&
    (item.reason === null || typeof item.reason === 'string')
  );
}

/** A run with its series: the parts a page cannot draw without. The rest of its fields are the type's. */
const isRunDetail = (run: unknown): boolean =>
  isObject(run) &&
  Number.isInteger(run.id) &&
  typeof run.phase === 'string' &&
  isObject(run.settings) &&
  Array.isArray(run.series);

/**
 * `GET /api/benchmark`: whether a benchmark can run here, the run going now and the last ten, **with their series**
 * (the snapshot of the stream has the summary without them). Its body is `{ benchmark }`, not a state view. A body that is
 * not the documented one fails loudly instead of rendering as "no runs".
 */
export async function getBenchmark(options: RequestOptions = {}): Promise<BenchmarkDetail> {
  const response = await send(
    '/api/benchmark',
    { headers: { Accept: 'application/json' } },
    options,
  );
  const body = await readJson(response);
  const detail = isObject(body) ? body.benchmark : undefined;
  if (
    !isObject(detail) ||
    typeof detail.available !== 'boolean' ||
    typeof detail.running !== 'boolean' ||
    typeof detail.maxMessages !== 'number' ||
    !(detail.current === null || isRunDetail(detail.current)) ||
    !Array.isArray(detail.runs) ||
    !detail.runs.every(isRunDetail)
  ) {
    throw new ApiError(
      response.status,
      'The simulator answered with a benchmark Studio does not understand',
    );
  }
  return detail as unknown as BenchmarkDetail;
}

/**
 * `GET /api/benchmark/preflight`: the three checks that a start needs, read now (the database is asked again when its last
 * answer is older than two seconds). Empty when the benchmark is not available. The simulator checks again on a start.
 */
export async function getBenchmarkPreflight(
  options: RequestOptions = {},
): Promise<BenchmarkPreflightAnswer> {
  const response = await send(
    '/api/benchmark/preflight',
    { headers: { Accept: 'application/json' } },
    options,
  );
  const body = await readJson(response);
  if (!isObject(body) || !Array.isArray(body.checks) || !body.checks.every(isBenchmarkCheck)) {
    throw new ApiError(
      response.status,
      'The simulator answered with checks Studio does not understand',
    );
  }
  return { checks: body.checks };
}

/**
 * Starts a benchmark run of `messages` messages. A benchmark saturates the broker and the CPU and writes its readings to the
 * database, so the simulator wants `confirm: true`; it is set here and only here, and the one caller is the confirmation
 * dialog's button. Refused with `400` (the field is named), `503` (not available), `409` when a check fails (`checksOf`
 * has them) or when another run is going. The answer is the run as it begins and the new state.
 */
export function startBenchmark(
  request: { messages: number },
  options: RequestOptions = {},
): Promise<BenchmarkStartAnswer> {
  return sendCommandFor<BenchmarkStartAnswer>(
    'POST',
    '/api/benchmark',
    { messages: request.messages, confirm: true },
    options,
    (body) => isObject(body.run) && Number.isInteger(body.run.id),
  );
}

/**
 * Stops the run that is going. The simulator answers **when the run has ended**, which can take several seconds (it asks
 * the process to stop, then ends it after 5 s); `409` when none is running. What was published stays published.
 */
export const stopBenchmark = (options: RequestOptions = {}) =>
  sendCommand('POST', '/api/benchmark/stop', undefined, options);

/**
 * The checks a refused start names, or `null` when `error` is not that refusal (a `409` whose body carries a non-empty
 * list of checks). A `409` of another kind, "another run is going", has none.
 */
export function checksOf(error: unknown): BenchmarkCheck[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const checks = isObject(error.body) ? error.body.checks : undefined;
  if (!Array.isArray(checks) || checks.length === 0 || !checks.every(isBenchmarkCheck)) return null;
  return checks;
}

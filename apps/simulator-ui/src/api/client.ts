import type { AlertsPage, PagedAlert, StateView } from './types';

/** A request the simulator refused or could not answer. `status` is 0 when it did not answer at all. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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

/** Sends a request and reads the simulator's answer as a state view (the answer of `GET /api/state` and of every command). */
async function fetchState(
  url: string,
  init: RequestInit,
  options: RequestOptions,
): Promise<StateView> {
  const response = await send(url, init, options);
  const body = await readJson(response);
  if (!isStateView(body))
    throw new ApiError(
      response.status,
      'The simulator answered with a state Studio does not understand',
    );
  return body;
}

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
  return fetchState(
    path,
    {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    options,
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

import type { StateView } from './types';

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

/** `GET /api/state`: everything the pages draw, in one reply. Commands (SIM-05 onward) answer with the same. */
export async function getState(options: RequestOptions = {}): Promise<StateView> {
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch('/api/state', {
      headers: { Accept: 'application/json' },
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Cannot reach the simulator');
  }
  const body = await readJson(response);
  if (!isStateView(body))
    throw new ApiError(
      response.status,
      'The simulator answered with a state Studio does not understand',
    );
  return body;
}

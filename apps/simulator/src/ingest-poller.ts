import { EventEmitter } from 'node:events';
import {
  AlertObserver,
  type IngestAlert,
  type ObservedAlert,
  parseAlerts,
} from './alert-observer.ts';
import type { Clock } from './clock.ts';
import type { ObservationDraft } from './observation-store.ts';
import { parseExposition, type Sample, selectForwarded } from './prometheus-text.ts';

/** The part of `fetch` the poller uses, so a test can pass a fake. */
export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export type IngestStatus = 'unknown' | 'ready' | 'not-ready' | 'unreachable';

/** What `GET /api/ready` of ingest says, or that it did not answer. */
export interface IngestState {
  status: IngestStatus;
  /** `up` or `down` as ingest reports them; `null` when ingest did not answer. */
  database: string | null;
  broker: string | null;
  /** `none` when ingest has no command center configured, else `ops-command-center`. */
  alertSink: string | null;
  /** Why ingest counts as unreachable. */
  detail: string | null;
  /** When `status` last changed (wall time, ISO 8601). */
  since: string | null;
  lastCheckedAt: string | null;
}

export interface AlertsFeed {
  alerts: ObservedAlert[];
  /** When the alerts were last read successfully. */
  lastOkAt: string | null;
  /** True until the first successful read, and while the last read failed. */
  stale: boolean;
}

export interface MetricsFeed {
  samples: Sample[];
  lastOkAt: string | null;
  stale: boolean;
}

export type PollerEvents = {
  /** The state of ingest changed (status, or what it says about its dependencies). */
  ingest: [IngestState];
  /** The alerts changed, or became stale or fresh again. */
  alerts: [AlertsFeed];
  /** A successful read of `/metrics`, or the metrics became stale. */
  metrics: [MetricsFeed];
  /** Something the timeline records, with the time it was seen. */
  observation: [draft: ObservationDraft, at: string];
};

/** The query of `GET /api/alerts` that Studio may send on (docs/api.md). Every part is optional. */
export interface AlertsPageQuery {
  status?: 'open' | 'cleared';
  limit?: number;
  /** A value ingest returned in `X-Next-Cursor`. Opaque: passed on unread, URL-encoded. */
  before?: string;
}

/** One page of ingest's alerts, newest first, and where the next one starts. */
export interface AlertsPage {
  alerts: IngestAlert[];
  /** Ingest's `X-Next-Cursor`, unchanged; `null` on the last page. */
  next: string | null;
}

/**
 * Ingest could not give a page. `refused` is ingest's own `400` (an older replica that does not know
 * `limit` or `before`, a cursor it did not issue): the request is at fault. `unreachable` is everything
 * else: no answer, a timeout, another status, a reply that is not the documented shape.
 */
export class IngestReadError extends Error {
  readonly kind: 'refused' | 'unreachable';

  constructor(kind: 'refused' | 'unreachable', message: string) {
    super(message);
    this.name = 'IngestReadError';
    this.kind = kind;
  }
}

export interface IngestPollerOptions {
  /** Base URL of ingest, without a trailing slash. */
  baseUrl: string;
  /** Wall clock in production. It sets the time of every observation, and schedules the cycles. */
  clock: Clock;
  fetch?: FetchLike;
  /** Time from the start of one cycle to the start of the next. */
  intervalMs?: number;
  /** Per request. Shorter than `intervalMs`, so a cycle never outlasts its slot. */
  timeoutMs?: number;
  /** For one page read for a person (`alertsPage`): up to 200 rows, so longer than a poll's. */
  pageTimeoutMs?: number;
  alertsLimit?: number;
  observer?: AlertObserver;
  /** One line per change of the state of ingest. Defaults to `console.log`. */
  log?: (line: string) => void;
}

type Read<T> = { ok: true; value: T } | { ok: false; reason: string };

interface ReadyBody {
  status: string;
  database: string;
  broker: string;
  alertSink: string;
}

function describeFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `no answer within ${timeoutMs} ms`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : String(error);
}

function parseReady(text: string): ReadyBody | undefined {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null) return undefined;
  const { status, database, broker, alertSink } = body as Record<string, unknown>;
  if (
    typeof status !== 'string' ||
    typeof database !== 'string' ||
    typeof broker !== 'string' ||
    typeof alertSink !== 'string'
  ) {
    return undefined;
  }
  return { status, database, broker, alertSink };
}

/** The reason in the body of an error of ingest's API (`{ statusCode, error, message }`), short and plain. */
function ingestMessage(text: string): string {
  const fallback = 'ingest refused the request';
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fallback;
  }
  const message = (body as { message?: unknown } | null)?.message;
  const joined = Array.isArray(message)
    ? message.filter((m) => typeof m === 'string').join('; ')
    : message;
  return typeof joined === 'string' && joined !== '' ? joined.slice(0, 200) : fallback;
}

/**
 * Reads ingest the way Studio needs to: `GET /api/ready`, `GET /api/alerts` and `/metrics`, about
 * once a second, each with a short timeout. Ingest is not modified and never asked for more than
 * its public read API gives.
 *
 * `/api/ready` alone decides whether ingest is reachable. A `503` from it is an answer (it says
 * which dependency is down), not a failure; anything else that is not a usable answer is
 * `unreachable`, on the first cycle it happens. A failing `/api/alerts` or `/metrics` while ready
 * still answers (an older replica refuses `limit`, say) keeps the last data and marks it stale.
 *
 * A cycle is never started before the last one ended, and nothing here throws into the caller or
 * lets a listener's exception stop the polling.
 */
export class IngestPoller extends EventEmitter<PollerEvents> {
  private readonly baseUrl: string;
  private readonly clock: Clock;
  private readonly fetchFn: FetchLike;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly pageTimeoutMs: number;
  private readonly alertsLimit: number;
  private readonly observer: AlertObserver;
  private readonly log: (line: string) => void;

  private ingest: IngestState = {
    status: 'unknown',
    database: null,
    broker: null,
    alertSink: null,
    detail: null,
    since: null,
    lastCheckedAt: null,
  };
  private alertsFeed: AlertsFeed = { alerts: [], lastOkAt: null, stale: true };
  private metricsFeed: MetricsFeed = { samples: [], lastOkAt: null, stale: true };
  private running = false;
  private abort = new AbortController();
  private cancelTimer: (() => void) | undefined;

  constructor(options: IngestPollerOptions) {
    super();
    this.baseUrl = options.baseUrl;
    this.clock = options.clock;
    this.fetchFn = options.fetch ?? ((url, init) => fetch(url, init));
    this.intervalMs = options.intervalMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 800;
    this.pageTimeoutMs = options.pageTimeoutMs ?? 3000;
    this.alertsLimit = options.alertsLimit ?? 100;
    this.observer = options.observer ?? new AlertObserver();
    this.log = options.log ?? ((line) => console.log(line));
  }

  state(): IngestState {
    return { ...this.ingest };
  }

  alerts(): AlertsFeed {
    return { ...this.alertsFeed };
  }

  metrics(): MetricsFeed {
    return { ...this.metricsFeed };
  }

  /** One alert as Studio saw it open, clear and deliver, or `undefined` when it never tracked it. */
  observedAlert(id: string): ObservedAlert | undefined {
    return this.observer.get(id);
  }

  /**
   * One page of ingest's alerts for a person who is paging: the query goes to ingest as it is and the
   * cursor comes back as ingest sent it, so Studio never builds one. Independent of the poll cycle: it
   * reads and parses, and changes no feed and emits no event. Throws `IngestReadError`.
   */
  async alertsPage(query: AlertsPageQuery = {}): Promise<AlertsPage> {
    const params = new URLSearchParams();
    if (query.status !== undefined) params.set('status', query.status);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.before !== undefined) params.set('before', query.before);
    const search = params.toString();

    let reply: { status: number; body: string; headers: Headers };
    try {
      reply = await this.get(
        `/api/alerts${search === '' ? '' : `?${search}`}`,
        this.abort.signal,
        this.pageTimeoutMs,
      );
    } catch (error) {
      throw new IngestReadError('unreachable', describeFailure(error, this.pageTimeoutMs));
    }
    if (reply.status === 400) throw new IngestReadError('refused', ingestMessage(reply.body));
    if (reply.status !== 200) throw new IngestReadError('unreachable', `HTTP ${reply.status}`);

    let json: unknown;
    try {
      json = JSON.parse(reply.body);
    } catch {
      throw new IngestReadError('unreachable', 'unexpected reply from /api/alerts');
    }
    const alerts = parseAlerts(json);
    if (!alerts) throw new IngestReadError('unreachable', 'unexpected reply from /api/alerts');
    const next = reply.headers.get('X-Next-Cursor');
    return { alerts, next: next === null || next === '' ? null : next };
  }

  /** Runs the first cycle at once and keeps polling. Resolves when that cycle has ended. */
  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    this.running = true;
    return this.loop();
  }

  /** Stops the schedule and aborts the requests in flight; their results are dropped. */
  stop(): void {
    this.running = false;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.abort.abort();
    this.abort = new AbortController();
  }

  /** One cycle: the three requests in parallel, then their results applied. Never rejects. */
  async pollOnce(): Promise<void> {
    const abort = this.abort;
    const [ready, alerts, metrics] = await Promise.all([
      this.readReady(abort.signal),
      this.readAlerts(abort.signal),
      this.readMetrics(abort.signal),
    ]);
    if (abort.signal.aborted) return;
    const at = new Date(this.clock.now()).toISOString();
    try {
      this.applyReady(ready, at);
      this.applyAlerts(alerts, at);
      this.applyMetrics(metrics, at);
    } catch (error) {
      // A bug here must not become an unhandled rejection in a timer and end the process.
      this.log(`ingest poller: a cycle could not be applied: ${String(error)}`);
    }
  }

  private async loop(): Promise<void> {
    const startedAt = this.clock.now();
    await this.pollOnce();
    if (!this.running) return;
    const wait = Math.max(0, this.intervalMs - (this.clock.now() - startedAt));
    this.cancelTimer = this.clock.setTimer(wait, () => this.loop());
  }

  private async get(
    path: string,
    signal: AbortSignal,
    timeoutMs: number = this.timeoutMs,
  ): Promise<{ status: number; body: string; headers: Headers }> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      signal: AbortSignal.any([signal, timeout]),
    });
    // The timeout covers reading the body too, so a reply that stalls half way still ends.
    return { status: res.status, body: await res.text(), headers: res.headers };
  }

  private async read<T>(
    path: string,
    signal: AbortSignal,
    accept: (reply: { status: number; body: string }) => Read<T>,
  ): Promise<Read<T>> {
    try {
      return accept(await this.get(path, signal));
    } catch (error) {
      return { ok: false, reason: describeFailure(error, this.timeoutMs) };
    }
  }

  private readReady(signal: AbortSignal): Promise<Read<{ ready: boolean; body: ReadyBody }>> {
    return this.read('/api/ready', signal, ({ status, body }) => {
      if (status !== 200 && status !== 503) return { ok: false, reason: `HTTP ${status}` };
      const parsed = parseReady(body);
      return parsed
        ? { ok: true, value: { ready: status === 200, body: parsed } }
        : { ok: false, reason: 'unexpected reply from /api/ready' };
    });
  }

  private readAlerts(signal: AbortSignal) {
    return this.read<IngestAlert[]>(
      `/api/alerts?limit=${this.alertsLimit}`,
      signal,
      ({ status, body }) => {
        if (status !== 200) return { ok: false, reason: `HTTP ${status}` };
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          return { ok: false, reason: 'unexpected reply from /api/alerts' };
        }
        const alerts = parseAlerts(json);
        return alerts
          ? { ok: true, value: alerts }
          : { ok: false, reason: 'unexpected reply from /api/alerts' };
      },
    );
  }

  private readMetrics(signal: AbortSignal) {
    return this.read<Sample[]>('/metrics', signal, ({ status, body }) =>
      status === 200
        ? { ok: true, value: selectForwarded(parseExposition(body)) }
        : { ok: false, reason: `HTTP ${status}` },
    );
  }

  private applyReady(result: Read<{ ready: boolean; body: ReadyBody }>, at: string): void {
    const previous = this.ingest;
    const next: IngestState = result.ok
      ? {
          status: result.value.ready ? 'ready' : 'not-ready',
          database: result.value.body.database,
          broker: result.value.body.broker,
          alertSink: result.value.body.alertSink,
          detail: null,
          since: previous.since,
          lastCheckedAt: at,
        }
      : {
          status: 'unreachable',
          database: null,
          broker: null,
          alertSink: null,
          detail: result.reason,
          since: previous.since,
          lastCheckedAt: at,
        };
    const fingerprint = (s: IngestState) => [s.status, s.database, s.broker, s.alertSink].join('|');
    if (previous.status !== next.status) next.since = at;
    // A new reason for the same outage replaces the old one on the state, but is not news.
    this.ingest = next;
    if (fingerprint(previous) === fingerprint(next)) return;

    this.log(this.describe(next));
    const draft: ObservationDraft = {
      kind: 'dependency',
      data: {
        name: 'ingest',
        from: previous.status,
        to: next.status,
        database: next.database,
        broker: next.broker,
        alertSink: next.alertSink,
        detail: next.detail,
      },
    };
    this.safely('observation', () => this.emit('observation', draft, at));
    this.safely('ingest', () => this.emit('ingest', this.state()));
  }

  private describe(state: IngestState): string {
    if (state.status === 'unreachable') {
      return `ingest: unreachable at ${this.baseUrl} (${state.detail ?? 'no reason given'})`;
    }
    return `ingest: ${state.status} (database ${state.database}, broker ${state.broker}, alert sink ${state.alertSink})`;
  }

  private applyAlerts(result: Read<IngestAlert[]>, at: string): void {
    if (!result.ok) {
      if (!this.alertsFeed.stale) {
        this.alertsFeed = { ...this.alertsFeed, stale: true };
        this.safely('alerts', () => this.emit('alerts', this.alerts()));
      }
      return;
    }
    const wasStale = this.alertsFeed.stale;
    const observation = this.observer.observe(result.value, at);
    this.alertsFeed = { alerts: observation.view, lastOkAt: at, stale: false };
    for (const draft of observation.events) {
      this.safely('observation', () => this.emit('observation', draft, at));
    }
    if (observation.changed || wasStale) {
      this.safely('alerts', () => this.emit('alerts', this.alerts()));
    }
  }

  private applyMetrics(result: Read<Sample[]>, at: string): void {
    if (!result.ok) {
      if (!this.metricsFeed.stale) {
        this.metricsFeed = { ...this.metricsFeed, stale: true };
        this.safely('metrics', () => this.emit('metrics', this.metrics()));
      }
      return;
    }
    this.metricsFeed = { samples: result.value, lastOkAt: at, stale: false };
    this.safely('metrics', () => this.emit('metrics', this.metrics()));
  }

  /** Runs an emit without letting a listener's exception reach the polling loop. */
  private safely(event: keyof PollerEvents, emit: () => void): void {
    try {
      emit();
    } catch (error) {
      this.log(`ingest poller: a "${event}" listener threw: ${String(error)}`);
    }
  }
}

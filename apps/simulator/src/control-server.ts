import { createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrokerLink } from './broker-link.ts';
import type { ControlConfig } from './control-config.ts';
import {
  buildStateView,
  createRoutes,
  errorBody,
  HttpError,
  type RouteResponse,
  type RoutesContext,
} from './control-routes.ts';
import type { Engine, PublishedMessage, StateChange } from './engine.ts';
import { EventStream, type EventStreamOptions } from './event-stream.ts';
import type { IngestPoller } from './ingest-poller.ts';
import { type ObservationDraft, ObservationStore, RingBuffer } from './observation-store.ts';
import type { DeviceSpec } from './signals.ts';
import { resolveStatic, studioIsBuilt } from './static-files.ts';

/** Largest request body accepted; the biggest legitimate one is an anomaly, a few hundred bytes. */
export const MAX_BODY_BYTES = 16 * 1024;
/** Published messages kept for a page that opens mid-demo (the first message of the stream). */
export const PUBLISH_LOG_SIZE = 200;

export interface ControlServerOptions {
  engine: Engine;
  /** The devices as loaded from the registry. */
  devices: DeviceSpec[];
  scenarios: Record<string, string[]>;
  /** Owned by the server: it starts it when it listens and stops it when it closes. */
  poller: IngestPoller;
  config: Pick<ControlConfig, 'host' | 'port' | 'ingestUrl' | 'consoleUrl'>;
  /** The simulator's own connection to the MQTT broker, reported in the state and on the stream. */
  broker: BrokerLink;
  /**
   * The directory with the built Studio UI. Served for `GET` and `HEAD` outside `/api/`; without it
   * (or with a directory that is not built) the API works and every other path is a `404`.
   */
  studioDir?: string;
  store?: ObservationStore;
  /** Wall clock for the time of an observation. Not the engine's clock, which may be simulated. */
  now?: () => number;
  log?: (line: string) => void;
  stream?: EventStreamOptions;
  maxBodyBytes?: number;
}

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

/** `Host: example.com:3200` is `example.com`; an IPv6 literal keeps its brackets. */
function hostnameOf(header: string): string {
  const host = header.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  return host.split(':')[0] ?? '';
}

function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * The control plane of the simulator: JSON commands, one server-sent-events stream and the reads of
 * ingest, in the engine's process. No authentication, as the design says (ADR-0011): it is a demo
 * surface that listens on loopback unless it was told otherwise. What it does check is the cheap
 * part of "a web page in the presenter's browser must not be able to drive it":
 *
 * - no CORS header is ever sent, so a page on another origin cannot read an answer;
 * - every command must be `Content-Type: application/json`, which a cross-site page cannot send
 *   without a preflight that this server does not answer;
 * - the `Host` header must name this machine, which stops DNS rebinding.
 *
 * Every listener it puts on the engine and on the poller is wrapped so that it cannot throw: the
 * engine emits `published` from the promise of a publish that succeeded, and an exception there
 * would turn it into a failed tick.
 */
export class ControlServer {
  readonly store: ObservationStore;
  private readonly options: ControlServerOptions;
  private readonly server: Server;
  private readonly stream: EventStream;
  private readonly publishLog = new RingBuffer<PublishedMessage>(PUBLISH_LOG_SIZE);
  private readonly context: RoutesContext;
  private readonly handle: ReturnType<typeof createRoutes>;
  private readonly allowedHosts: Set<string>;
  private readonly maxBodyBytes: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private detach: (() => void) | undefined;

  constructor(options: ControlServerOptions) {
    this.options = options;
    this.store = options.store ?? new ObservationStore();
    this.stream = new EventStream(options.stream);
    this.maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
    this.allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const bound = options.config.host.toLowerCase();
    if (!WILDCARD_HOSTS.has(bound)) {
      this.allowedHosts.add(bound.includes(':') && !bound.startsWith('[') ? `[${bound}]` : bound);
    }
    this.context = {
      engine: options.engine,
      devices: options.devices,
      scenarios: options.scenarios,
      store: this.store,
      ingest: options.poller,
      config: { ingestUrl: options.config.ingestUrl, consoleUrl: options.config.consoleUrl },
      broker: options.broker,
      // A command that has done its work must not fail because the timeline could not note it.
      record: this.safely('record', (draft: ObservationDraft) => this.observe(draft)),
    };
    this.handle = createRoutes(this.context);
    this.server = createServer((req, res) => void this.onRequest(req, res));
  }

  /**
   * Binds the address, starts forwarding the engine's events and starts polling ingest. Rejects with
   * a message that names the settings to change when the address cannot be used. `studio` says
   * whether the UI directory holds a build, so the caller can tell the user.
   */
  async listen(): Promise<AddressInfo & { studio: boolean }> {
    const { host, port } = this.options.config;
    const detach = this.attach();
    this.detach = detach;
    try {
      await new Promise<void>((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(port, host, () => {
          this.server.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      detach();
      this.detach = undefined;
      const reason = (error as NodeJS.ErrnoException).code ?? String(error);
      throw new Error(
        `Cannot listen on ${host}:${port} (${reason}). Change CONTROL_HOST or CONTROL_PORT (or --control-host, --control-port), or stop what is using the port.`,
        { cause: error },
      );
    }
    this.server.on('error', (error) => this.log(`control server: ${String(error)}`));
    void this.options.poller.start();
    const { studioDir } = this.options;
    return {
      ...(this.server.address() as AddressInfo),
      studio: studioDir !== undefined && studioIsBuilt(studioDir),
    };
  }

  /** Stops polling and forwarding, ends the streams and closes the listener. */
  async close(): Promise<void> {
    this.detach?.();
    this.detach = undefined;
    this.options.poller.stop();
    this.stream.close();
    if (!this.server.listening) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  /** Stores an observation and tells the stream about it. */
  private observe(draft: ObservationDraft, at: string = this.stamp()): void {
    this.stream.send('observation', this.store.append(draft, at));
  }

  private safely<A extends unknown[]>(
    label: string,
    fn: (...args: A) => void,
  ): (...args: A) => void {
    return (...args) => {
      try {
        fn(...args);
      } catch (error) {
        this.log(`control server: a "${label}" listener threw: ${String(error)}`);
      }
    };
  }

  /** Puts the listeners on the engine and the poller; returns the function that takes them off. */
  private attach(): () => void {
    const { engine, poller, broker } = this.options;

    const onState = this.safely('state', (change: StateChange) => {
      this.stream.send('state', change);
      this.observe({ kind: 'engine-state', data: { ...change } });
    });
    const onPublished = this.safely('published', (message: PublishedMessage) => {
      this.publishLog.push(message);
      this.stream.send('published', message);
    });
    const onTickError = this.safely('tick-error', (error: Error) => {
      this.stream.send('tick-error', { message: error.message });
      this.observe({ kind: 'tick-error', data: { message: error.message } });
    });
    engine.on('state', onState);
    engine.on('published', onPublished);
    engine.on('tick-error', onTickError);

    const onIngest = this.safely('ingest', (state) => this.stream.send('ingest', state));
    const onAlerts = this.safely('alerts', (feed) => this.stream.send('alerts', feed));
    const onMetrics = this.safely('metrics', (feed) => this.stream.send('metrics', feed));
    const onObservation = this.safely('observation', (draft: ObservationDraft, at: string) =>
      this.observe(draft, at),
    );
    const onBroker = this.safely('broker', (state) => this.stream.send('broker', state));
    broker.on('change', onBroker);
    poller.on('ingest', onIngest);
    poller.on('alerts', onAlerts);
    poller.on('metrics', onMetrics);
    poller.on('observation', onObservation);

    return () => {
      engine.off('state', onState);
      engine.off('published', onPublished);
      engine.off('tick-error', onTickError);
      poller.off('ingest', onIngest);
      poller.off('alerts', onAlerts);
      poller.off('metrics', onMetrics);
      poller.off('observation', onObservation);
      broker.off('change', onBroker);
    };
  }

  private async onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await this.dispatch(req, res);
    } catch (error) {
      this.log(`control server: request failed: ${String(error)}`);
      if (res.headersSent) res.destroy();
      else this.reply(res, { status: 500, body: errorBody(500, 'Internal error') });
    }
  }

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host;
    if (host === undefined || !this.allowedHosts.has(hostnameOf(host))) {
      return this.reply(res, {
        status: 403,
        body: errorBody(403, 'The Host header must name this machine (localhost or 127.0.0.1)'),
      });
    }

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return this.reply(res, { status: 400, body: errorBody(400, 'The request URL is not valid') });
    }
    const method = req.method ?? 'GET';

    if (method === 'GET' && url.pathname === '/api/stream') return this.openStream(res);

    const { studioDir } = this.options;
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (studioDir !== undefined && !isApi && (method === 'GET' || method === 'HEAD')) {
      return this.serveStudio(res, method, studioDir, url.pathname);
    }

    let body: unknown;
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      if (mediaType(req.headers['content-type']) !== 'application/json') {
        return this.reply(res, {
          status: 415,
          body: errorBody(415, 'Commands must be sent with Content-Type: application/json'),
        });
      }
      try {
        body = await this.readBody(req);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        return this.reply(res, {
          status: error.status,
          body: errorBody(error.status, error.message),
        });
      }
    }

    this.reply(
      res,
      await this.handle({ method, path: url.pathname, query: url.searchParams, body }),
    );
  }

  /**
   * Reads and parses the body. Past the limit the rest is read and thrown away (not stored), so the
   * client still gets its `413` instead of a reset connection.
   */
  private readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let tooLarge = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.maxBodyBytes) {
          tooLarge = true;
          chunks.length = 0;
        } else if (!tooLarge) {
          chunks.push(chunk);
        }
      });
      req.on('error', reject);
      req.on('close', () =>
        reject(new HttpError(400, 'The client closed the connection before the body ended')),
      );
      req.on('end', () => {
        if (tooLarge) {
          return reject(
            new HttpError(413, `The request body is larger than ${this.maxBodyBytes} bytes`),
          );
        }
        const text = Buffer.concat(chunks).toString('utf8').trim();
        if (text === '') return resolve(undefined);
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new HttpError(400, 'The request body is not valid JSON'));
        }
      });
    });
  }

  /** The built UI: a file, the app's `index.html` for one of its routes, or a `404`. */
  private serveStudio(
    res: ServerResponse,
    method: string,
    studioDir: string,
    pathname: string,
  ): void {
    const result = resolveStatic(studioDir, pathname);
    res.writeHead(result.status, result.headers);
    if (method === 'HEAD' || result.file === undefined) {
      res.end(method === 'HEAD' ? undefined : result.body);
      return;
    }
    createReadStream(result.file)
      .on('error', () => res.destroy())
      .pipe(res);
  }

  private openStream(res: ServerResponse): void {
    const snapshot = { ...buildStateView(this.context), publishLog: this.publishLog.toArray() };
    if (!this.stream.add(res, { event: 'snapshot', data: snapshot })) {
      this.reply(res, {
        status: 503,
        body: errorBody(503, 'Too many clients are reading the event stream'),
      });
    }
  }

  /** No CORS header is added here or anywhere else, on purpose. */
  private reply(res: ServerResponse, response: RouteResponse): void {
    const text = JSON.stringify(response.body);
    res.writeHead(response.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...response.headers,
    });
    res.end(text);
  }
}

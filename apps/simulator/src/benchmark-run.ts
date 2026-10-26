import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseChildMessage, type ParentMessage } from './bench-protocol.ts';
import {
  type BenchResult,
  checkDatabase as realCheckDatabase,
  DEFAULT_TIMEOUT_S,
  type DatabaseCheck,
  describeDatabase,
  expectedReadings,
  MAX_MESSAGES,
} from './bench-run.ts';
import {
  queueDelayS,
  rampUpEndS,
  readBuckets,
  windowQuantile,
  type Bucket,
} from './bench-series.ts';
import { type Clock, systemClock } from './clock.ts';
import type { IngestState, MetricsFeed } from './ingest-poller.ts';
import type { Sample } from './prometheus-text.ts';
import type { DeviceSpec } from './signals.ts';

/**
 * The benchmark as the control server runs it: one run at a time, in a child process (`bench-worker.ts`) so that
 * the saturated broker connection and the CPU it takes do not share an event loop with the stream, the poller and
 * the Stop command. This class owns the child, checks before a run, keeps what a run reported, and makes sure a run
 * always ends: Stop asks, then terminates, then kills; a child that goes quiet is killed; closing the server ends it.
 */

/** Runs kept in memory for the session, newest first. */
export const KEPT_RUNS = 10;
/** A run is bounded by its timeout; this only guards the memory if something goes wrong with that. */
export const MAX_SERIES_POINTS = 1000;
/** A child that says nothing for this long is hung (it reports every few hundred milliseconds). */
export const SILENCE_MS = 120_000;
/** After `stop`, the child has this long to end the run at its next window before it is terminated. */
export const STOP_GRACE_MS = 5000;
/** After `SIGTERM`, this long before `SIGKILL`. */
export const TERMINATE_GRACE_MS = 3000;
/** After it reported the result, the child has this long to exit before it is killed. */
export const EXIT_GRACE_MS = 5000;
const DATABASE_CHECK_TTL_MS = 2000;
const DATABASE_CHECK_TIMEOUT_MS = 2000;

const FLUSH = 'telemetry_flush_duration_seconds';

export type RunPhase = 'starting' | 'publishing' | 'waiting' | 'ended';
export type RunOutcome = 'completed' | 'incomplete' | 'stopped' | 'failed';

/** One sample of a run, about once a second: the series the charts draw. `null` is unknown, never zero. */
export interface BenchmarkPoint {
  /** Seconds since the run started, to a tenth. */
  t: number;
  /** Messages the broker acknowledged. */
  published: number;
  /** Readings stored since the run started: from ingest's counter while publishing, from the database after. */
  stored: number | null;
  /** `telemetry_buffered_readings`. */
  buffered: number | null;
  /** The 95th percentile of the flush time over the last read, in seconds. */
  flushP95S: number | null;
  /** Estimated: readings in flight over the rate they are stored at, in seconds (see `queueDelayS`). */
  queueDelayS: number | null;
}

/** A run without its series: what every state answer carries. */
export interface BenchmarkRunSummary {
  /** The run's number in this session, from 1. */
  id: number;
  startedAt: string;
  endedAt: string | null;
  phase: RunPhase;
  outcome: RunOutcome | null;
  /** Why a run did not complete, in words: stopped by the operator, the child's error, an exit code. */
  reason: string | null;
  /** True only for a run that completed: a stopped, incomplete or failed run is not a result to compare. */
  comparable: boolean | null;
  settings: { messages: number; devices: number; timeoutS: number };
  expectedReadings: number;
  /** Messages acknowledged (the page's published bar). */
  published: number;
  /** Readings stored so far (the page's stored bar), or `null` when it cannot be known. */
  stored: number | null;
  elapsedMs: number;
  /** The CLI's result, exactly; `null` until the child reports it. */
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
  /** Finished runs, newest first. */
  runs: BenchmarkRunSummary[];
}

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

/** What the run needs to know about the fleet before it starts: nothing may be publishing. */
export interface FleetView {
  /** Devices in the `running` state. */
  running: string[];
  /** Scenarios that are playing. */
  scenarios: string[];
}

/** The benchmark process, as far as this class is concerned; `forkWorker` is the real one and a test passes a fake. */
export interface BenchChild {
  send(message: ParentMessage): void;
  kill(signal: NodeJS.Signals): void;
  onMessage(listener: (value: unknown) => void): void;
  /** Called once, with how it ended. Also for a process that could not be started. */
  onExit(listener: (how: string) => void): void;
}

export class BenchmarkUnavailableError extends Error {
  constructor(reason: string) {
    super(`The benchmark is not available: ${reason}`);
    this.name = 'BenchmarkUnavailableError';
  }
}

export class BenchmarkBusyError extends Error {
  constructor(message = 'A benchmark is running; stop it first') {
    super(message);
    this.name = 'BenchmarkBusyError';
  }
}

export class PreflightFailedError extends Error {
  readonly checks: BenchmarkCheck[];

  constructor(checks: BenchmarkCheck[]) {
    const failed = checks.filter((check) => !check.ok);
    super(
      `The benchmark cannot start: ${failed.map((check) => `${check.label.toLowerCase()} failed${check.reason ? ` (${check.reason})` : ''}`).join('; ')}`,
    );
    this.name = 'PreflightFailedError';
    this.checks = checks;
  }
}

/** The settings of a start, checked. Never throws; the reason names the field. */
export function parseBenchmarkStart(
  body: unknown,
): { ok: true; value: { messages: number } } | { ok: false; reason: string } {
  const input = body ?? {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'The request body must be a JSON object' };
  }
  const fields = input as Record<string, unknown>;
  const extra = Object.keys(fields).find((key) => key !== 'messages' && key !== 'confirm');
  if (extra !== undefined)
    return { ok: false, reason: `"${extra}" is not a known field of the request` };
  const { messages, confirm } = fields;
  if (
    !Number.isInteger(messages) ||
    (messages as number) < 1 ||
    (messages as number) > MAX_MESSAGES
  ) {
    return {
      ok: false,
      reason: `"messages" must be a whole number from 1 to ${MAX_MESSAGES.toLocaleString('en-US')}`,
    };
  }
  if (confirm !== true) {
    return {
      ok: false,
      reason:
        '"confirm" must be true: a benchmark saturates the broker and the CPU and writes its readings to the database, so it needs an explicit confirmation',
    };
  }
  return { ok: true, value: { messages: messages as number } };
}

export interface BenchmarkOptions {
  /** Both are needed for a run; without either the benchmark is reported as not configured. */
  brokerUrl?: string;
  databaseUrl?: string;
  /** The registry the engine runs: the run publishes to these devices. */
  devices: DeviceSpec[];
  ingest: () => IngestState;
  fleet: () => FleetView;
  spawn?: () => BenchChild;
  checkDatabase?: (url: string, timeoutMs: number) => Promise<DatabaseCheck>;
  /** The wall clock and the timers. A `ManualClock` in tests. */
  clock?: Clock;
}

type Events = {
  /** A run started, changed phase or ended. */
  change: [run: BenchmarkRunSummary];
  /** One sample was added to the series of the run that is going. */
  point: [point: BenchmarkPoint, run: BenchmarkRunSummary];
};

interface Run extends BenchmarkRunDetail {
  startedMs: number;
  /** Readings stored by the time the run started, from ingest's counter; `null` when it could not be read. */
  baselineStored: number | null;
  /** The last count the child made after publishing (readings since the run started). */
  childStored: number | null;
  previousFlush: Bucket[] | undefined;
  previousStored: { t: number; stored: number } | undefined;
  stopRequested: boolean;
}

/** The sum of `name` over the samples whose labels include `labels`, or `null` when there is none. */
function sum(
  samples: readonly Sample[],
  name: string,
  labels: Record<string, string> = {},
): number | null {
  let total: number | null = null;
  for (const sample of samples) {
    if (sample.name !== name) continue;
    if (!Object.entries(labels).every(([key, value]) => sample.labels[key] === value)) continue;
    total = (total ?? 0) + sample.value;
  }
  return total;
}

const isFresh = (feed: MetricsFeed | undefined): feed is MetricsFeed =>
  feed !== undefined && !feed.stale && feed.lastOkAt !== null;

/** A run as the state carries it: every field but the series, copied so a later change does not reach a reader. */
function summaryOf(run: BenchmarkRunSummary): BenchmarkRunSummary {
  return {
    id: run.id,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    phase: run.phase,
    outcome: run.outcome,
    reason: run.reason,
    comparable: run.comparable,
    settings: { ...run.settings },
    expectedReadings: run.expectedReadings,
    published: run.published,
    stored: run.stored,
    elapsedMs: run.elapsedMs,
    result: run.result ? { ...run.result } : null,
    marks: { ...run.marks },
  };
}

function detailOf(run: BenchmarkRunDetail): BenchmarkRunDetail {
  return { ...summaryOf(run), series: run.series.map((point) => ({ ...point })) };
}

/** Starts the real benchmark process. */
function forkWorker(): BenchChild {
  const child = fork(fileURLToPath(new URL('./bench-worker.ts', import.meta.url)), [], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  return {
    send: (message) => void child.send(message, () => undefined),
    kill: (signal) => void child.kill(signal),
    onMessage: (listener) => void child.on('message', listener),
    onExit: (listener) => {
      child.on('exit', (code, signal) =>
        listener(signal ? `killed by ${signal}` : `exited with code ${code}`),
      );
      child.on('error', (error) => listener(`could not be started: ${error.message}`));
    },
  };
}

export class BenchmarkRun extends EventEmitter<Events> {
  private readonly options: BenchmarkOptions;
  private readonly clock: Clock;
  private readonly unavailable: string | null;
  private readonly spawn: () => BenchChild;
  private readonly checkDatabase: NonNullable<BenchmarkOptions['checkDatabase']>;
  private active: Run | undefined;
  private finished: BenchmarkRunDetail[] = [];
  private child: BenchChild | undefined;
  private reserved = false;
  private closed = false;
  private lastRunId = 0;
  private latestFeed: MetricsFeed | undefined;
  private databaseCheck: { at: number; result: Promise<DatabaseCheck> } | undefined;
  private settledWaiters: (() => void)[] = [];
  private timers = new Set<() => void>();
  private cancelSilence: (() => void) | undefined;

  constructor(options: BenchmarkOptions) {
    super();
    this.options = options;
    this.clock = options.clock ?? systemClock;
    this.unavailable =
      options.brokerUrl === undefined || options.databaseUrl === undefined
        ? 'not configured'
        : null;
    this.spawn = options.spawn ?? forkWorker;
    this.checkDatabase = options.checkDatabase ?? realCheckDatabase;
  }

  /** True while a run is going; the routes that publish refuse then. */
  get running(): boolean {
    return this.active !== undefined;
  }

  view(): BenchmarkSummary {
    return {
      available: this.unavailable === null,
      reason: this.unavailable,
      database:
        this.options.databaseUrl === undefined ? null : describeDatabase(this.options.databaseUrl),
      maxMessages: MAX_MESSAGES,
      running: this.running,
      current: this.active ? summaryOf(this.active) : null,
      runs: this.finished.map(summaryOf),
    };
  }

  detail(): BenchmarkDetail {
    return {
      ...this.view(),
      current: this.active ? detailOf(this.active) : null,
      runs: this.finished.map(detailOf),
    };
  }

  /** The three checks of the page. `fresh` asks the database again instead of using an answer under 2 s old. */
  async preflight(options: { fresh?: boolean } = {}): Promise<BenchmarkCheck[]> {
    const { databaseUrl } = this.options;
    if (this.unavailable !== null || databaseUrl === undefined) return [];
    const ingest = this.options.ingest();
    const fleet = this.options.fleet();
    const database = await this.databaseResult(databaseUrl, options.fresh === true);
    const busy = [
      ...fleet.running.slice(0, 5).map((id) => `${id} is running`),
      ...(fleet.running.length > 5 ? [`and ${fleet.running.length - 5} more devices`] : []),
      ...fleet.scenarios.map((name) => `scenario "${name}" is playing`),
    ];
    return [
      {
        id: 'ingest',
        label: 'Ingest ready',
        ok: ingest.status === 'ready',
        reason:
          ingest.status === 'ready'
            ? null
            : ingest.status === 'unknown'
              ? 'ingest has not been read yet'
              : (ingest.detail ??
                `ingest is ${ingest.status} (database ${ingest.database}, broker ${ingest.broker})`),
      },
      {
        id: 'database',
        label: 'Database reachable',
        ok: database.ok,
        reason: database.ok ? null : database.reason,
      },
      {
        id: 'fleet',
        label: 'Fleet paused',
        ok: busy.length === 0,
        reason: busy.length === 0 ? null : busy.join(', '),
      },
    ];
  }

  /**
   * Checks, then starts the child. Refuses with `BenchmarkUnavailableError`, `BenchmarkBusyError` (a run is going, or
   * the last child has not left yet) or `PreflightFailedError` (the checks are made again here: the page's earlier
   * answer is not trusted). Resolves with the run as it begins.
   */
  async start(settings: { messages: number }): Promise<BenchmarkRunSummary> {
    const { brokerUrl, databaseUrl } = this.options;
    if (this.unavailable !== null || brokerUrl === undefined || databaseUrl === undefined) {
      throw new BenchmarkUnavailableError(this.unavailable ?? 'not configured');
    }
    if (this.closed) throw new BenchmarkUnavailableError('the server is closing');
    if (this.active || this.reserved) throw new BenchmarkBusyError();
    if (this.child) throw new BenchmarkBusyError('The previous benchmark process is still ending');
    // Taken before the first await, so two starts that arrive together cannot both pass.
    this.reserved = true;
    try {
      const checks = await this.preflight({ fresh: true });
      if (checks.some((check) => !check.ok)) throw new PreflightFailedError(checks);
      if (this.closed) throw new BenchmarkUnavailableError('the server is closing');

      const { devices } = this.options;
      const timeoutS = DEFAULT_TIMEOUT_S;
      const id = ++this.lastRunId;
      const feed = this.latestFeed;
      const run: Run = {
        id,
        startedAt: new Date(this.clock.now()).toISOString(),
        endedAt: null,
        phase: 'starting',
        outcome: null,
        reason: null,
        comparable: null,
        settings: { messages: settings.messages, devices: devices.length, timeoutS },
        expectedReadings: expectedReadings(devices, settings.messages),
        published: 0,
        stored: null,
        elapsedMs: 0,
        result: null,
        marks: { publishEndedS: null, rampUpEndS: null },
        series: [],
        startedMs: this.clock.now(),
        baselineStored: isFresh(feed)
          ? sum(feed.samples, 'telemetry_readings_total', { result: 'stored' })
          : null,
        childStored: null,
        previousFlush: isFresh(feed) ? readBuckets(feed.samples, FLUSH) : undefined,
        previousStored: undefined,
        stopRequested: false,
      };
      const child = this.spawn();
      this.child = child;
      this.active = run;
      child.onMessage((value) => this.onChildMessage(run, value));
      child.onExit((how) => this.onChildExit(child, run, how));
      this.armSilence(run);
      child.send({
        type: 'start',
        broker: brokerUrl,
        database: databaseUrl,
        devices,
        messages: settings.messages,
        timeoutS,
        run: id,
      });
      this.safely(() => this.emit('change', summaryOf(run)));
      return summaryOf(run);
    } finally {
      this.reserved = false;
    }
  }

  /** Asks the run to stop and resolves when it has ended and its process has gone. `false` when none was running. */
  async stop(): Promise<boolean> {
    const run = this.active;
    if (!run) return false;
    if (!run.stopRequested) {
      run.stopRequested = true;
      this.child?.send({ type: 'stop' });
      // The child ends the run at its next window of messages; if it does not, it is terminated, then killed.
      this.later(STOP_GRACE_MS, () => this.terminate(run));
    }
    await this.settled();
    return true;
  }

  /** What the server calls on every read of ingest: keeps the latest, and adds a point to the run that is going. */
  onMetrics(feed: MetricsFeed): void {
    this.latestFeed = feed;
    const run = this.active;
    if (!run) return;
    const fresh = isFresh(feed);
    const t = Math.round(((this.clock.now() - run.startedMs) / 1000) * 10) / 10;

    const delta = fresh
      ? sum(feed.samples, 'telemetry_readings_total', { result: 'stored' })
      : null;
    const stored =
      run.phase === 'waiting' && run.childStored !== null
        ? run.childStored
        : delta !== null && run.baselineStored !== null
          ? Math.max(0, delta - run.baselineStored)
          : null;
    const buckets = fresh ? readBuckets(feed.samples, FLUSH) : undefined;
    const flushP95S = buckets ? windowQuantile(run.previousFlush, buckets, 0.95) : null;
    if (buckets) run.previousFlush = buckets;

    let delay: number | null = null;
    if (stored !== null && run.previousStored && t > run.previousStored.t) {
      const rate = (stored - run.previousStored.stored) / (t - run.previousStored.t);
      const inFlight = expectedReadings(this.options.devices, run.published) - stored;
      delay = queueDelayS(inFlight, rate);
    }
    if (stored !== null) run.previousStored = { t, stored };
    if (stored !== null) run.stored = stored;

    const point: BenchmarkPoint = {
      t,
      published: run.published,
      stored,
      buffered: fresh ? sum(feed.samples, 'telemetry_buffered_readings') : null,
      flushP95S,
      queueDelayS: delay,
    };
    // The last slot is replaced rather than the series grown past its bound.
    if (run.series.length >= MAX_SERIES_POINTS) run.series[run.series.length - 1] = point;
    else run.series.push(point);
    this.safely(() => this.emit('point', { ...point }, summaryOf(run)));
  }

  /** Ends a run that is going and the process that carries it; leaves nothing running. */
  async close(): Promise<void> {
    this.closed = true;
    await this.stop();
    // A process that reported its result and has not exited yet.
    if (this.child) {
      this.child.kill('SIGKILL');
      this.child = undefined;
      this.release();
    }
    this.cancelSilenceTimer();
    this.cancelTimers();
  }

  private databaseResult(url: string, fresh: boolean): Promise<DatabaseCheck> {
    const now = this.clock.now();
    if (!fresh && this.databaseCheck && now - this.databaseCheck.at < DATABASE_CHECK_TTL_MS) {
      return this.databaseCheck.result;
    }
    const result = this.checkDatabase(url, DATABASE_CHECK_TIMEOUT_MS).catch(
      (error: unknown): DatabaseCheck => ({
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    this.databaseCheck = { at: now, result };
    return result;
  }

  private onChildMessage(run: Run, value: unknown): void {
    if (run.phase === 'ended') return;
    const message = parseChildMessage(value);
    if (message === undefined) return;
    this.armSilence(run);
    if (message.type === 'progress') {
      const { progress } = message;
      run.published = progress.published;
      run.elapsedMs = progress.elapsedMs;
      if (progress.stored !== null) {
        run.childStored = progress.stored;
        run.stored = progress.stored;
      }
      if (progress.phase !== run.phase) {
        run.phase = progress.phase;
        if (progress.phase === 'waiting') {
          run.marks.publishEndedS =
            Math.round(((this.clock.now() - run.startedMs) / 1000) * 100) / 100;
        }
        this.safely(() => this.emit('change', summaryOf(run)));
      }
    } else if (message.type === 'done') {
      this.finish(run, message.outcome, {
        result: message.result,
        reason: message.outcome === 'stopped' ? 'Stopped by the operator' : null,
      });
      // The child exits on its own now; if it does not, it is killed.
      this.later(EXIT_GRACE_MS, () => this.kill());
    } else {
      this.finish(run, 'failed', { reason: message.message });
      this.later(EXIT_GRACE_MS, () => this.kill());
    }
  }

  private onChildExit(child: BenchChild, run: Run, how: string): void {
    if (this.child !== child) return;
    this.child = undefined;
    if (run.phase !== 'ended') {
      if (run.stopRequested) {
        this.finish(run, 'stopped', { reason: 'Stopped by the operator' });
      } else {
        this.finish(run, 'failed', { reason: `The benchmark process ${how}` });
      }
    }
    this.release();
  }

  private finish(
    run: Run,
    outcome: RunOutcome,
    details: { result?: BenchResult; reason: string | null },
  ): void {
    if (run.phase === 'ended') return;
    const now = this.clock.now();
    run.phase = 'ended';
    run.outcome = outcome;
    run.comparable = outcome === 'completed';
    run.reason = details.reason;
    run.endedAt = new Date(now).toISOString();
    if (details.result) {
      run.result = details.result;
      if (outcome !== 'stopped') run.published = details.result.messages;
      run.stored = details.result.readingsStored;
      run.elapsedMs = Math.round(details.result.endToEndSeconds * 1000);
      run.marks.publishEndedS = details.result.publishSeconds;
    } else {
      run.elapsedMs = now - run.startedMs;
    }
    run.marks.rampUpEndS =
      outcome === 'completed' || outcome === 'incomplete'
        ? rampUpEndS(
            run.series.map(({ t, published }) => ({ t, published })),
            run.settings.messages,
          )
        : null;
    this.cancelSilenceTimer();
    this.active = undefined;
    this.finished = [detailOf(run), ...this.finished].slice(0, KEPT_RUNS);
    this.safely(() => this.emit('change', summaryOf(run)));
    this.release();
  }

  /** `SIGTERM` the process of a run that did not stop on request, and `SIGKILL` it if it still does not go. */
  private terminate(run: Run): void {
    if (this.active !== run || !this.child) return;
    // Armed before the signal: a process that exits on it releases the run and cancels every timer.
    this.later(TERMINATE_GRACE_MS, () => {
      if (this.active === run || this.child) {
        this.kill();
        if (run.phase !== 'ended') {
          this.finish(run, 'stopped', {
            reason: 'The benchmark process did not stop on request and was ended',
          });
        }
      }
    });
    this.child.kill('SIGTERM');
  }

  private kill(): void {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    child.kill('SIGKILL');
    this.release();
  }

  private onSilence(run: Run): void {
    if (this.active !== run) return;
    this.kill();
    this.finish(run, 'failed', {
      reason: `The benchmark process was silent for ${SILENCE_MS / 1000} s and was ended`,
    });
  }

  private armSilence(run: Run): void {
    this.cancelSilenceTimer();
    this.cancelSilence = this.clock.setTimer(SILENCE_MS, () => this.onSilence(run));
  }

  private cancelSilenceTimer(): void {
    this.cancelSilence?.();
    this.cancelSilence = undefined;
  }

  /** A timer of the stop and exit escalations; all of them are cancelled once nothing is left to stop. */
  private later(delayMs: number, fn: () => void): void {
    this.timers.add(this.clock.setTimer(delayMs, fn));
  }

  private cancelTimers(): void {
    for (const cancel of this.timers) cancel();
    this.timers.clear();
  }

  /** Resolves when no run is going and no process is left. */
  private settled(): Promise<void> {
    if (!this.active && !this.child) return Promise.resolve();
    return new Promise((resolve) => this.settledWaiters.push(resolve));
  }

  private release(): void {
    if (this.active || this.child) return;
    this.cancelTimers();
    const waiters = this.settledWaiters;
    this.settledWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** A listener's exception must not reach the child's message handler. */
  private safely(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.log(`benchmark: a listener threw: ${String(error)}`);
    }
  }
}

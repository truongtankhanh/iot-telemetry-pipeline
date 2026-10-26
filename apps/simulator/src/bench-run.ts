import { telemetryTopic } from '@itp/telemetry-contract';
import { connectAsync } from 'mqtt';
import { cpus } from 'node:os';
import pg from 'pg';
import type { DeviceSpec } from './signals.ts';

/**
 * End-to-end throughput: publishes N messages as fast as the broker accepts them, then waits until every
 * reading is in PostgreSQL. Measures the whole path (broker, ingest, batch writes, rollups, rule evaluation),
 * not just publishing.
 *
 * This is the loop of `bench.ts` without a process around it, so that the command line and Studio's
 * Analytics page run the same code: the same formulas, the same rounding, the same count of what is stored.
 */

/** The most messages one run takes from Studio: the cap of `deploy/bench/run-baseline.sh`. */
export const MAX_MESSAGES = 250_000;
/** How long the wait for storage lasts, in seconds, when the run is not told otherwise. */
export const DEFAULT_TIMEOUT_S = 120;
export const DEFAULT_DATABASE_URL = 'postgres://postgres:postgres@localhost:5433/telemetry';

/** The sequence number the CLI counts from, which `run-gap-check.sh` seeds into the ledger. */
const BASE_SEQ = 1_000_000;
/** Messages in flight at once. */
const WINDOW = 500;
const POLL_MS = 100;
const PROGRESS_EVERY_MS = 250;
const HOUR_MS = 60 * 60_000;
/** Messages are stamped this far apart, so that no two readings of a device share a `ts`. */
const TS_STEP_MS = 10;

/** What a run measured: the fields of the `--json` line, in its order. `deploy/bench/run-baseline.sh` reads them. */
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

/**
 * `completed`: every expected reading was stored. `incomplete`: the wait ended at the timeout first.
 * `stopped`: the signal ended the run; its numbers are partial and `readingsStored` is the last count seen
 * while waiting (0 when it stopped while publishing: the count is not read then, see `onProgress`).
 */
export type BenchOutcome = 'completed' | 'incomplete' | 'stopped';

export interface BenchProgress {
  phase: 'publishing' | 'waiting';
  /** Messages the broker has acknowledged, counted a window at a time. */
  published: number;
  /** Readings stored since the run started; `null` while publishing, when the database is not asked. */
  stored: number | null;
  elapsedMs: number;
}

/** What a run needs from the outside; the real one is `connectBenchIo`, a test passes a fake. */
export interface BenchIo {
  /** Publishes at QoS 1; resolves on the PUBACK. */
  publish(topic: string, payload: string): Promise<unknown>;
  /** Readings that arrived since the run's connection was made, by the database's clock. */
  countStored(): Promise<number>;
  /** A monotonic clock in milliseconds, for the times of the run. */
  now(): number;
  /** Wall time in milliseconds since the epoch, for the `ts` of the messages and the deadline. */
  wall(): number;
  sleep(ms: number): Promise<void>;
}

export interface BenchOptions {
  devices: readonly DeviceSpec[];
  messages: number;
  timeoutS: number;
  io: BenchIo;
  /** Ends the run at the next window of messages or the next poll. */
  signal?: AbortSignal;
  onProgress?: (progress: BenchProgress) => void;
  /** The sequence number of each device's first message; a device not named starts at 1,000,001, as the CLI does. */
  firstSeq?: Readonly<Record<string, number>>;
  /** The `ts` of message 0, in ms since the epoch; the CLI uses an hour ago and so does a run that gives none. */
  tsBase?: number;
  log?: (line: string) => void;
}

/** The readings `messages` messages carry when message `i` goes to device `i % devices.length`. */
export function expectedReadings(devices: readonly DeviceSpec[], messages: number): number {
  const count = devices.length;
  const perRound = devices.reduce((sum, device) => sum + device.metrics.length, 0);
  const rounds = Math.floor(messages / count);
  const rest = devices
    .slice(0, messages % count)
    .reduce((sum, device) => sum + device.metrics.length, 0);
  return rounds * perRound + rest;
}

/**
 * The `ts` of message 0 for the `run`-th run of a Studio session: an hour ago, aligned down to a multiple of
 * `10 ms × devices`, plus an offset of 1 to `10 × devices − 1` ms that depends on the run. Message `i`
 * goes to device `i % devices` with `ts = base + 10·i`, so two runs collide on `(device_id, metric, ts)`
 * only when their bases differ by a multiple of that step: with a different offset each, they never do (for
 * up to `10 × devices − 1` runs; the CLI's plain `Date.now() − 1 h` collides about one time in `10 × devices`).
 */
export function sessionTsBase(input: { wallMs: number; devices: number; run: number }): number {
  const step = TS_STEP_MS * Math.max(1, input.devices);
  const aligned = Math.floor((input.wallMs - HOUR_MS) / step) * step;
  return aligned + 1 + ((Math.max(1, input.run) - 1) % Math.max(1, step - 1));
}

function seconds(ms: number): number {
  return Number((ms / 1000).toFixed(2));
}

function perSecond(count: number, ms: number): number {
  return ms > 0 ? Math.round(count / (ms / 1000)) : 0;
}

export async function runBenchmark(
  options: BenchOptions,
): Promise<{ outcome: BenchOutcome; result: BenchResult }> {
  const { devices, messages: total, timeoutS, io, signal, onProgress } = options;
  if (!Number.isInteger(total) || total < 1) {
    throw new RangeError(`messages must be a whole number of 1 or more, got ${total}`);
  }
  if (devices.length === 0) throw new RangeError('A benchmark needs at least one device');
  const log = options.log ?? ((line: string) => console.log(line));

  const expected = expectedReadings(devices, total);
  // Distinct timestamps inside the accepted window.
  const base = options.tsBase ?? io.wall() - HOUR_MS;
  const before = await io.countStored();
  log(`Publishing ${total} messages (${expected} readings) from ${devices.length} devices…`);

  const started = io.now();
  const next = new Map<string, number>();
  const inFlight: Promise<unknown>[] = [];
  let handed = 0;
  let published = 0;
  let stopped = false;
  let lastProgress = started;
  const report = (progress: Omit<BenchProgress, 'elapsedMs'>) =>
    onProgress?.({ ...progress, elapsedMs: io.now() - started });

  for (let i = 0; i < total; i++) {
    if (i % WINDOW === 0 && signal?.aborted) {
      stopped = true;
      break;
    }
    const device = devices[i % devices.length]!;
    const seq = next.get(device.id) ?? options.firstSeq?.[device.id] ?? BASE_SEQ + 1;
    next.set(device.id, seq + 1);
    const metrics = Object.fromEntries(device.metrics.map((m) => [m, 20 + (i % 10)]));
    const payload = JSON.stringify({
      seq,
      ts: new Date(base + i * TS_STEP_MS).toISOString(),
      metrics,
    });
    inFlight.push(
      io.publish(telemetryTopic({ zoneCode: device.zoneCode, deviceId: device.id }), payload),
    );
    handed++;
    if (inFlight.length >= WINDOW) {
      await Promise.all(inFlight.splice(0));
      published = handed;
      if (io.now() - lastProgress >= PROGRESS_EVERY_MS) {
        lastProgress = io.now();
        report({ phase: 'publishing', published, stored: null });
      }
    }
  }
  await Promise.all(inFlight);
  published = handed;
  const publishedAt = io.now();
  if (!stopped) report({ phase: 'publishing', published, stored: null });

  let stored = before;
  const deadline = io.wall() + timeoutS * 1000;
  while (!stopped && stored - before < expected && io.wall() < deadline) {
    if (signal?.aborted) {
      stopped = true;
      break;
    }
    await io.sleep(POLL_MS);
    stored = await io.countStored();
    report({ phase: 'waiting', published, stored: stored - before });
  }
  const persisted = io.now();

  const elapsedMs = persisted - started;
  const result: BenchResult = {
    messages: total,
    readingsExpected: expected,
    readingsStored: stored - before,
    publishSeconds: seconds(publishedAt - started),
    endToEndSeconds: seconds(elapsedMs),
    messagesPerSecond: perSecond(total, elapsedMs),
    readingsPerSecond: perSecond(stored - before, elapsedMs),
    vcpu: cpus().length,
    node: process.versions.node,
  };
  const outcome: BenchOutcome = stopped
    ? 'stopped'
    : stored - before === expected
      ? 'completed'
      : 'incomplete';
  return { outcome, result };
}

/** The connection of a run: the broker client and the database pool, closed together. */
export interface BenchConnection extends BenchIo {
  /** Where each device's next message should be numbered to continue from the ledger: `last_seq + 1`. A device with none is not named. */
  firstSeqs(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

/** Connects to the broker and the database, the way the CLI always has (QoS 1, counts by the database clock). */
export async function connectBenchIo(input: {
  broker: string;
  database: string;
}): Promise<BenchConnection> {
  const db = new pg.Pool({ connectionString: input.database });
  let client: Awaited<ReturnType<typeof connectAsync>> | undefined;
  let runStart: Date;
  try {
    client = await connectAsync(input.broker, {
      protocolVersion: 5,
      clientId: `bench-${process.pid}`,
    });
    // Count by arrival time (database clock), so earlier runs never leak into this one's numbers.
    runStart = (await db.query<{ now: Date }>('SELECT now()')).rows[0]!.now;
  } catch (error) {
    await client?.endAsync().catch(() => undefined);
    await db.end().catch(() => undefined);
    throw error;
  }
  const connected = client;
  return {
    publish: (topic, payload) => connected.publishAsync(topic, payload, { qos: 1 }),
    countStored: async () =>
      Number(
        (await db.query(`SELECT count(*) FROM reading WHERE received_at >= $1`, [runStart])).rows[0]
          .count,
      ),
    now: () => performance.now(),
    wall: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    firstSeqs: async () => {
      const { rows } = await db.query<{ id: string; last_seq: string | null }>(
        'SELECT id, last_seq FROM device',
      );
      const first: Record<string, number> = {};
      for (const { id, last_seq } of rows) {
        const last = last_seq === null ? NaN : Number(last_seq);
        if (Number.isSafeInteger(last)) first[id] = last + 1;
      }
      return first;
    },
    close: async () => {
      await connected.endAsync();
      await db.end();
    },
  };
}

function firstSet(...candidates: (string | undefined)[]): string | undefined {
  return candidates.find((value) => value !== undefined && value.trim() !== '')?.trim();
}

/** The database to count in: `--database`, then `DATABASE_URL`, then the Compose one. One rule for the CLI and Studio. */
export function resolveDatabaseUrl(input: {
  flag?: string | undefined;
  env: Record<string, string | undefined>;
}): string {
  return firstSet(input.flag, input.env.DATABASE_URL) ?? DEFAULT_DATABASE_URL;
}

/** `host:port/name` of a database URL, for people to read: never the user or the password. */
export function describeDatabase(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'an invalid DATABASE_URL';
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  return `${parsed.hostname || 'local socket'}:${parsed.port || '5432'}${name === '' ? '' : `/${name}`}`;
}

/** An error message with anything that looks like `user:password@` taken out, so a reason can be shown. */
export function redact(message: string): string {
  return message.replace(/\/\/[^/\s@]*@/g, '//***@');
}

export type DatabaseCheck = { ok: true } | { ok: false; reason: string };

/** Whether the database answers `SELECT 1` within `timeoutMs`, on a connection of its own. Never throws. */
export async function checkDatabase(url: string, timeoutMs = 2000): Promise<DatabaseCheck> {
  let client: pg.Client | undefined;
  try {
    // Built inside the try: a URL `pg` cannot parse throws from the constructor.
    client = new pg.Client({
      connectionString: url,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
    });
    // A client that fails after connecting emits `error`; nothing is listening for it past this check.
    client.on('error', () => undefined);
    await client.connect();
    await client.query('SELECT 1');
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: redact(typeof code === 'string' ? `${code}: ${detail}` : detail) };
  } finally {
    await client?.end().catch(() => undefined);
  }
}

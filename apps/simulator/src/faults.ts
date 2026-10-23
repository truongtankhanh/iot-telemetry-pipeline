import {
  MAX_PAYLOAD_BYTES,
  METRICS,
  type MetricName,
  type TelemetryPayload,
} from '@itp/telemetry-contract';

/**
 * The faults an operator can switch on: ways to make the simulator's transport misbehave. Everything here is pure
 * (no timers, no I/O, no engine), so that what a fault does to a message can be tested with a seeded random source.
 * The engine applies them (`engine.ts`).
 */

export const FAULT_KINDS = [
  'drop',
  'duplicate',
  'delay',
  'reorder',
  'malformed',
  'link-loss',
] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

/** The faults that act on each message of a device; link loss acts on the connection and burst is a one-shot. */
export type SwitchKind = Exclude<FaultKind, 'link-loss'>;

/**
 * One generator per reason a message can be rejected for on its way in: the nine of `parsePayload`, in the order it
 * checks them, and `topic`, which is `parseTopic`'s. The ingest-only reasons (`unknown_device`, `future`, …) are not
 * here on purpose.
 */
export const MALFORMED_KINDS = [
  'size',
  'json',
  'shape',
  'seq',
  'ts',
  'empty',
  'metric',
  'value',
  'range',
  'topic',
] as const;
export type MalformedKind = (typeof MALFORMED_KINDS)[number];

/** Marks a message that is not a plain one, on the `published` event. Delay and reorder leave no mark in the message. */
export type FaultTag = 'duplicate' | 'burst' | `malformed:${MalformedKind}`;

export const FAULT_LIMITS = {
  /** Under `SEQUENCE_GRACE_MS` (30 s), so that a delay alone does not make ingest count a message as lost. */
  maxDelayMs: 10_000,
  minWindow: 2,
  maxWindow: 10,
  maxBurst: 5_000,
  maxLinkLossS: 3_600,
  /** Messages of a burst handed to the publisher at once; the next chunk waits for this one. */
  burstChunk: 250,
} as const;

export interface PercentConfig {
  /** Share of messages hit, above 0 and at most 100. */
  percent: number;
}

export interface DelayConfig {
  delayMs: number;
  /** Each message waits `delayMs` plus or minus up to this much. */
  jitterMs: number;
}

export interface ReorderConfig {
  /** Messages of a device held back and released in a different order. */
  window: number;
}

export interface MalformedConfig extends PercentConfig {
  /** One of these is chosen at random for each message hit. Never empty. */
  kinds: MalformedKind[];
}

export interface LinkLossConfig {
  /** Seconds until the link is restored by itself; `null` until someone restores it. */
  forS: number | null;
}

export interface FaultConfigs {
  drop: PercentConfig;
  duplicate: PercentConfig;
  delay: DelayConfig;
  reorder: ReorderConfig;
  malformed: MalformedConfig;
  'link-loss': LinkLossConfig;
}

/** Which devices the switches and a burst act on. Link loss is the simulator's own connection and has no scope. */
export type FaultScope = { mode: 'running' } | { mode: 'selected'; deviceIds: string[] };

export const DEFAULT_SCOPE: FaultScope = { mode: 'running' };

/** What `snapshot()` says about the faults; an absent fault is `null`, so the JSON has the same keys either way. */
export interface FaultsSnapshot {
  scope: FaultScope;
  drop: PercentConfig | null;
  duplicate: PercentConfig | null;
  delay: DelayConfig | null;
  reorder: ReorderConfig | null;
  malformed: MalformedConfig | null;
  /** While the link is down: since when (the engine's clock, ISO 8601) and the automatic restore, if any. */
  linkLoss: { since: string; forS: number | null } | null;
  /** Switches that are on, plus link loss while the link is down. A burst is a one-shot and is not counted. */
  activeCount: number;
  /** Running devices in scope now (the chosen ones, for a selection). */
  deviceCount: number;
  /** Messages held back now by delay or reorder. */
  held: number;
  /** Messages dropped by a fault or by link loss since the process started. */
  dropped: number;
  bursting: boolean;
}

/** The simulator's own connection to the broker, as the engine may cut and restore it. `main.ts` adapts the MQTT client. */
export interface LinkControl {
  cut(): Promise<void>;
  restore(): Promise<void>;
}

/** Thrown for a command that is right but meets the state of the faults (a burst while one is sending, or the link is down). */
export class FaultConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultConflictError';
  }
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

function objectBody(body: unknown, allowed: readonly string[]): Parsed<Record<string, unknown>> {
  if (body === undefined) return { ok: true, value: {} };
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('The request body must be a JSON object');
  }
  const extra = Object.keys(body).find((key) => !allowed.includes(key));
  if (extra !== undefined) return fail(`"${extra}" is not a known field of the request`);
  return { ok: true, value: body as Record<string, unknown> };
}

function finiteNumber(
  body: Record<string, unknown>,
  name: string,
  min: number,
  max: number,
  options: { minExclusive?: boolean; integer?: boolean } = {},
): Parsed<number> {
  const value = body[name];
  const range = options.minExclusive ? `above ${min} and at most ${max}` : `from ${min} to ${max}`;
  const what = options.integer ? 'an integer' : 'a number';
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`"${name}" must be ${what} ${range}`);
  }
  if (options.integer && !Number.isInteger(value))
    return fail(`"${name}" must be ${what} ${range}`);
  if ((options.minExclusive ? value <= min : value < min) || value > max) {
    return fail(`"${name}" must be ${what} ${range}`);
  }
  return { ok: true, value };
}

function parsePercent(body: unknown): Parsed<PercentConfig> {
  const object = objectBody(body, ['percent']);
  if (!object.ok) return object;
  const percent = finiteNumber(object.value, 'percent', 0, 100, { minExclusive: true });
  return percent.ok ? { ok: true, value: { percent: percent.value } } : percent;
}

function parseMalformed(body: unknown): Parsed<MalformedConfig> {
  const object = objectBody(body, ['percent', 'kinds']);
  if (!object.ok) return object;
  const percent = finiteNumber(object.value, 'percent', 0, 100, { minExclusive: true });
  if (!percent.ok) return percent;
  const { kinds } = object.value;
  if (kinds === undefined) return { ok: true, value: { percent: percent.value, kinds: ['range'] } };
  if (!Array.isArray(kinds) || kinds.length === 0) {
    return fail(`"kinds" must be a non-empty list of: ${MALFORMED_KINDS.join(', ')}`);
  }
  for (const kind of kinds) {
    if (typeof kind !== 'string' || !(MALFORMED_KINDS as readonly string[]).includes(kind)) {
      return fail(`"kinds" has an unknown kind; use: ${MALFORMED_KINDS.join(', ')}`);
    }
  }
  return {
    ok: true,
    value: { percent: percent.value, kinds: [...new Set(kinds as MalformedKind[])] },
  };
}

function parseDelay(body: unknown): Parsed<DelayConfig> {
  const object = objectBody(body, ['delayMs', 'jitterMs']);
  if (!object.ok) return object;
  const delayMs = finiteNumber(object.value, 'delayMs', 1, FAULT_LIMITS.maxDelayMs);
  if (!delayMs.ok) return delayMs;
  if (object.value.jitterMs === undefined) {
    return { ok: true, value: { delayMs: delayMs.value, jitterMs: 0 } };
  }
  const jitterMs = finiteNumber(object.value, 'jitterMs', 0, delayMs.value);
  return jitterMs.ok
    ? { ok: true, value: { delayMs: delayMs.value, jitterMs: jitterMs.value } }
    : jitterMs;
}

function parseReorder(body: unknown): Parsed<ReorderConfig> {
  const object = objectBody(body, ['window']);
  if (!object.ok) return object;
  const window = finiteNumber(
    object.value,
    'window',
    FAULT_LIMITS.minWindow,
    FAULT_LIMITS.maxWindow,
    {
      integer: true,
    },
  );
  return window.ok ? { ok: true, value: { window: window.value } } : window;
}

function parseLinkLoss(body: unknown): Parsed<LinkLossConfig> {
  const object = objectBody(body, ['forS']);
  if (!object.ok) return object;
  const { forS } = object.value;
  if (forS === undefined || forS === null) return { ok: true, value: { forS: null } };
  const seconds = finiteNumber(object.value, 'forS', 1, FAULT_LIMITS.maxLinkLossS);
  return seconds.ok ? { ok: true, value: { forS: seconds.value } } : seconds;
}

const PARSERS: { [K in FaultKind]: (body: unknown) => Parsed<FaultConfigs[K]> } = {
  drop: parsePercent,
  duplicate: parsePercent,
  delay: parseDelay,
  reorder: parseReorder,
  malformed: parseMalformed,
  'link-loss': parseLinkLoss,
};

/** Checks the body of a fault command. Never throws; the reason names the field. */
export function parseFaultConfig<K extends FaultKind>(
  kind: K,
  body: unknown,
): Parsed<FaultConfigs[K]> {
  return PARSERS[kind](body);
}

/**
 * `{ mode: 'running' }` or `{ mode: 'selected', deviceIds: [...] }`. A selection must be a non-empty list of devices the
 * registry has; `unknownDevice` tells the route that the request is right but names something that does not exist.
 */
export function parseScope(
  body: unknown,
  knownDeviceIds: readonly string[],
): { ok: true; value: FaultScope } | { ok: false; reason: string; unknownDevice?: true } {
  const object = objectBody(body, ['mode', 'deviceIds']);
  if (!object.ok) return object;
  const { mode, deviceIds } = object.value;
  if (mode === 'running') {
    if (deviceIds !== undefined) return fail('"deviceIds" is only for the mode "selected"');
    return { ok: true, value: { mode: 'running' } };
  }
  if (mode !== 'selected') return fail('"mode" must be "running" or "selected"');
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    return fail('"deviceIds" must be a non-empty list of device ids');
  }
  for (const id of deviceIds) {
    if (typeof id !== 'string' || id === '') return fail('"deviceIds" must hold device ids');
    if (!knownDeviceIds.includes(id)) {
      return { ok: false, reason: `Unknown device "${id}"`, unknownDevice: true };
    }
  }
  return { ok: true, value: { mode: 'selected', deviceIds: [...new Set(deviceIds as string[])] } };
}

export function parseBurst(body: unknown): Parsed<{ count: number }> {
  const object = objectBody(body, ['count']);
  if (!object.ok) return object;
  const count = finiteNumber(object.value, 'count', 1, FAULT_LIMITS.maxBurst, { integer: true });
  return count.ok ? { ok: true, value: { count: count.value } } : count;
}

/** True with the given chance. 100 always hits; `random` is in [0, 1). */
export function chance(percent: number, random: () => number): boolean {
  return random() * 100 < percent;
}

/** How long one message waits: the delay, plus or minus up to the jitter, never below 0. `random` is used only with a jitter. */
export function delayFor(config: DelayConfig, random: () => number): number {
  if (config.jitterMs === 0) return config.delayMs;
  return Math.max(0, config.delayMs + (random() * 2 - 1) * config.jitterMs);
}

/** A copy of `items` in a different order (Fisher–Yates). A window of two or more never comes out as it went in. */
export function shuffleWindow<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  if (out.length > 1 && out.every((item, i) => item === items[i])) {
    [out[0], out[1]] = [out[1] as T, out[0] as T];
  }
  return out;
}

/** What goes on the wire: the topic and the body as text. */
export interface WireMessage {
  topic: string;
  body: string;
}

/** A valid message, as the engine built it. */
export interface ValidMessage {
  topic: string;
  payload: TelemetryPayload;
}

/**
 * A copy of a valid message that breaks the contract in exactly one way, so that ingest rejects it with `kind` as the
 * reason. `parsePayload` checks in a fixed order and stops at the first problem, so each generator leaves everything
 * that is checked before its own reason valid. Sizes, ranges and names come from the contract, never from here.
 * `random` only chooses which metric is damaged, and which way.
 */
export function malformedMessage(
  kind: MalformedKind,
  { topic, payload }: ValidMessage,
  random: () => number,
): WireMessage {
  const names = Object.keys(payload.metrics) as MetricName[];
  const pick = () =>
    names[Math.min(names.length - 1, Math.floor(random() * names.length))] as MetricName;
  const withMetrics = (metrics: Record<string, unknown>) => JSON.stringify({ ...payload, metrics });
  const valid = JSON.stringify(payload);

  switch (kind) {
    case 'size':
      // Checked first, so what is inside does not matter; it must be over the limit in characters and in bytes.
      return { topic, body: JSON.stringify({ ...payload, pad: 'x'.repeat(MAX_PAYLOAD_BYTES) }) };
    case 'json':
      return { topic, body: valid.slice(0, -1) };
    case 'shape':
      // A primitive: `[]` or `{}` is an object and would be read as a payload with no `seq`.
      return { topic, body: random() < 0.5 ? '42' : 'null' };
    case 'seq':
      return {
        topic,
        body: JSON.stringify({
          ...payload,
          seq: random() < 0.5 ? -(payload.seq + 1) : payload.seq + 0.5,
        }),
      };
    case 'ts':
      // No zone: ISO 8601 with a zone is what the contract asks for.
      return { topic, body: JSON.stringify({ ...payload, ts: payload.ts.replace(/Z$/, '') }) };
    case 'empty':
      return { topic, body: withMetrics({}) };
    case 'metric':
      return { topic, body: withMetrics({ ...payload.metrics, pressure_pa: 1013 }) };
    case 'value':
      return { topic, body: withMetrics({ ...payload.metrics, [pick()]: null }) };
    case 'range': {
      const metric = pick();
      const { min, max } = METRICS[metric];
      return {
        topic,
        body: withMetrics({ ...payload.metrics, [metric]: random() < 0.5 ? max + 1 : min - 1 }),
      };
    }
    case 'topic':
      // The suffix is not `telemetry`; the body is a good message that went to the wrong place.
      return { topic: `${topic}x`, body: valid };
  }
}

/**
 * The wire contract between devices and the ingest service.
 *
 * Topic:   campus/<zoneCode>/<deviceId>/telemetry
 * Payload: { "seq": 42, "ts": "2026-10-01T08:00:00.000Z", "metrics": { "temperature_c": 24.3 } }
 *
 * Everything here is dependency-free so firmware teams, the simulator and the service can share it.
 */

export const TOPIC_ROOT = 'campus';
export const TELEMETRY_SUFFIX = 'telemetry';

/** Subscription filter matching every device's telemetry topic. */
export const TELEMETRY_FILTER = `${TOPIC_ROOT}/+/+/${TELEMETRY_SUFFIX}`;

export const METRICS = {
  temperature_c: { unit: '°C', min: -40, max: 85 },
  humidity_pct: { unit: '%', min: 0, max: 100 },
  co2_ppm: { unit: 'ppm', min: 0, max: 10_000 },
  power_kw: { unit: 'kW', min: 0, max: 10_000 },
} as const;

export type MetricName = keyof typeof METRICS;
export const METRIC_NAMES = Object.keys(METRICS) as MetricName[];

/**
 * Largest accepted payload, in bytes. A legitimate message is a few hundred bytes (four metrics at
 * most), so the cap bounds the decode and parse cost a single message can impose on the consumer.
 */
export const MAX_PAYLOAD_BYTES = 4096;

export interface TelemetryPayload {
  /** Per-device counter, incremented on every message. Lets the receiver measure gaps. */
  seq: number;
  /** Measurement time, ISO 8601 with a zone (`Z` or `±HH:mm`). `parsePayload` returns it normalised to UTC. */
  ts: string;
  metrics: Partial<Record<MetricName, number>>;
}

export interface TopicParts {
  zoneCode: string;
  deviceId: string;
}

const decoder = new TextDecoder();
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** Shape only: year, month, day and hour are captured for the calendar check in `parseTimestamp`. */
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function telemetryTopic({ zoneCode, deviceId }: TopicParts): string {
  return `${TOPIC_ROOT}/${zoneCode}/${deviceId}/${TELEMETRY_SUFFIX}`;
}

/** Strips an MQTT 5 shared-subscription prefix (`$share/<group>/`) if present. */
export function withShareGroup(filter: string, group?: string): string {
  return group ? `$share/${group}/${filter}` : filter;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Epoch milliseconds of a strict ISO 8601 timestamp with a zone, or NaN when it must be rejected.
 * `Date.parse` alone is not enough: it reads a zone-less string as the server's local time, accepts
 * date-only strings and free text, and rolls `02-31` over to March. It stays as the range check for
 * month, minute, second and offset. The day is checked by rule, not by a `Date.UTC` round trip,
 * because `Date.UTC` maps the years 0 to 99 to 1900 to 1999.
 *
 * Exported so that anything else that reads a timestamp (the HTTP API reads `from` and `to` with it)
 * applies this rule and not its own: one string must not mean two instants.
 */
export function parseTimestamp(ts: string): number {
  const match = TIMESTAMP.exec(ts);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  // Hour 24 is valid ISO 8601 and V8 rolls it to the next day; the contract does not accept it.
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23) return NaN;
  return Date.parse(ts);
}

export function parseTopic(topic: string): ParseResult<TopicParts> {
  const parts = topic.split('/');
  if (parts.length !== 4 || parts[0] !== TOPIC_ROOT || parts[3] !== TELEMETRY_SUFFIX) {
    return { ok: false, reason: 'topic' };
  }
  const [, zoneCode, deviceId] = parts as [string, string, string, string];
  if (!SEGMENT.test(zoneCode) || !SEGMENT.test(deviceId)) return { ok: false, reason: 'topic' };
  return { ok: true, value: { zoneCode, deviceId } };
}

/**
 * Validates the payload size, shape and value ranges. Returns a short machine-friendly reason on
 * failure, used as a metrics label — so reasons are a small fixed set, never free text.
 */
export function parsePayload(raw: Uint8Array | string): ParseResult<TelemetryPayload> {
  // Checked before decoding so an oversized payload costs nothing. For a string, `length` counts
  // UTF-16 units, which is a lower bound on the UTF-8 bytes; MQTT delivers a Buffer, so the string
  // path is for tests and other callers, and encoding just to count bytes would allocate per message.
  const size = typeof raw === 'string' ? raw.length : raw.byteLength;
  if (size > MAX_PAYLOAD_BYTES) return { ok: false, reason: 'size' };

  let data: unknown;
  try {
    data = JSON.parse(typeof raw === 'string' ? raw : decoder.decode(raw));
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (typeof data !== 'object' || data === null) return { ok: false, reason: 'shape' };
  const { seq, ts, metrics } = data as Record<string, unknown>;

  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    return { ok: false, reason: 'seq' };
  }
  const time = typeof ts === 'string' ? parseTimestamp(ts) : NaN;
  if (Number.isNaN(time)) return { ok: false, reason: 'ts' };
  if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) {
    return { ok: false, reason: 'shape' };
  }

  const entries = Object.entries(metrics);
  if (entries.length === 0) return { ok: false, reason: 'empty' };
  for (const [name, value] of entries) {
    // Own properties only: `METRICS` inherits from Object.prototype, so a bare lookup would accept
    // `constructor`, `toString` or `__proto__` as metrics (and then skip the range check).
    if (!Object.hasOwn(METRICS, name)) return { ok: false, reason: 'metric' };
    const spec = METRICS[name as MetricName];
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'value' };
    if (value < spec.min || value > spec.max) return { ok: false, reason: 'range' };
  }

  return { ok: true, value: { seq, ts: new Date(time).toISOString(), metrics } };
}

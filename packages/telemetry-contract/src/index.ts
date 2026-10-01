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

export interface TelemetryPayload {
  /** Per-device counter, incremented on every message. Lets the receiver measure gaps. */
  seq: number;
  /** Measurement time, ISO 8601 UTC. */
  ts: string;
  metrics: Partial<Record<MetricName, number>>;
}

export interface TopicParts {
  zoneCode: string;
  deviceId: string;
}

const decoder = new TextDecoder();
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function telemetryTopic({ zoneCode, deviceId }: TopicParts): string {
  return `${TOPIC_ROOT}/${zoneCode}/${deviceId}/${TELEMETRY_SUFFIX}`;
}

/** Strips an MQTT 5 shared-subscription prefix (`$share/<group>/`) if present. */
export function withShareGroup(filter: string, group?: string): string {
  return group ? `$share/${group}/${filter}` : filter;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

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
 * Validates the payload shape and value ranges. Returns a short machine-friendly reason on failure,
 * used as a metrics label — so reasons are a small fixed set, never free text.
 */
export function parsePayload(raw: Uint8Array | string): ParseResult<TelemetryPayload> {
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
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return { ok: false, reason: 'ts' };
  if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) {
    return { ok: false, reason: 'shape' };
  }

  const entries = Object.entries(metrics);
  if (entries.length === 0) return { ok: false, reason: 'empty' };
  for (const [name, value] of entries) {
    const spec = METRICS[name as MetricName];
    if (!spec) return { ok: false, reason: 'metric' };
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'value' };
    if (value < spec.min || value > spec.max) return { ok: false, reason: 'range' };
  }

  return { ok: true, value: { seq, ts: new Date(ts).toISOString(), metrics } };
}

import type { PublishedMessage } from '../api/types';
import { formatClockTime } from './time';

/** How a message that is not a plain one is marked in the table. */
export type RowTag = 'duplicate' | 'burst' | 'republish' | 'malformed';

/** The longest start of an unreadable payload kept for the Metrics column. */
const SUMMARY_LENGTH = 80;

/**
 * One published message as the Event stream shows it, worked out once when the message arrives: parsing a payload
 * for every row on every render would be work per message, and a message arrives hundreds of times a second.
 */
export interface MessageRow {
  /** The simulator's id of the message: the key of the row and what a republish names. */
  id: number;
  deviceId: string;
  seq: number;
  topic: string;
  payload: string;
  /** The payload's own time (follows the engine's clock, which may be simulated). */
  ts: string;
  /** The wall time of the broker's acknowledgement, else `ts`, as `HH:MM:SS.mmm`; `—` when neither is a time. */
  time: string;
  /** The same moment in ms, for ordering and for "since"; `null` when there is none. */
  atMs: number | null;
  /** The metrics of the payload when it is `{ metrics: { name: number } }` with at least one; else empty. */
  metrics: { name: string; value: number }[];
  /** `name value · name value`, or the start of the text when the payload could not be read. */
  summary: string;
  /** False for a payload that is not JSON, has no `metrics` or has none that is a number: it is shown as it is. */
  readable: boolean;
  /** Bytes of the payload, as the contract measures it (not characters). */
  sizeBytes: number;
  /** Milliseconds from handing the message to the client to its PUBACK; `null` when the simulator did not say. */
  ackMs: number | null;
  tag: RowTag | null;
  /** The simulator's own `fault` text (`malformed:range`), for the title of the tag. */
  fault: string | null;
  /** The payload indented, when it is a JSON object; `null` otherwise. */
  pretty: string | null;
}

function parseObject(payload: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function metricsOf(object: Record<string, unknown> | null): { name: string; value: number }[] {
  const metrics = object?.metrics;
  if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) return [];
  return Object.entries(metrics)
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([name, value]) => ({ name, value: value as number }));
}

function tagOf(fault: string | undefined): RowTag | null {
  if (fault === undefined) return null;
  if (fault.startsWith('malformed')) return 'malformed';
  if (fault === 'duplicate' || fault === 'burst' || fault === 'republish') return fault;
  return null;
}

function clockWithMs(ms: number, timeZone: string | undefined): string {
  const fraction = String(((ms % 1000) + 1000) % 1000).padStart(3, '0');
  return `${formatClockTime(ms, timeZone)}.${fraction}`;
}

/**
 * The row of a message, or `null` for one that cannot be kept: without a numeric `id` it cannot be told from another
 * or named in a republish. `timeZone` is for a test; the page shows the viewer's.
 */
export function toRow(
  message: PublishedMessage,
  options: { timeZone?: string } = {},
): MessageRow | null {
  const { id } = message;
  if (typeof id !== 'number' || !Number.isFinite(id)) return null;

  const atMs = Date.parse(message.at ?? message.ts);
  const hasTime = Number.isFinite(atMs);
  const object = parseObject(message.payload);
  const metrics = metricsOf(object);
  const readable = metrics.length > 0;
  const text = message.payload.replace(/\s+/g, ' ').trim();

  return {
    id,
    deviceId: message.deviceId,
    seq: message.seq,
    topic: message.topic,
    payload: message.payload,
    ts: message.ts,
    time: hasTime ? clockWithMs(atMs, options.timeZone) : '—',
    atMs: hasTime ? atMs : null,
    metrics,
    summary: readable
      ? metrics.map(({ name, value }) => `${name} ${value}`).join(' · ')
      : text.length > SUMMARY_LENGTH
        ? `${text.slice(0, SUMMARY_LENGTH)}…`
        : text,
    readable,
    sizeBytes: new TextEncoder().encode(message.payload).length,
    ackMs:
      typeof message.ackMs === 'number' && Number.isFinite(message.ackMs) ? message.ackMs : null,
    tag: tagOf(message.fault),
    fault: message.fault ?? null,
    pretty: object === null ? null : JSON.stringify(object, null, 2),
  };
}

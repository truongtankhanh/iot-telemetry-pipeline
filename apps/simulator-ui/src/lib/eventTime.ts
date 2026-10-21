import type { TimeZoneChoice } from './preferences';

/**
 * The times of the event timeline in the zone the viewer chose (their own, or UTC): the clock of a row and the value of
 * the two fields of a custom range. Kept apart from the components so the arithmetic of a zone can be tested.
 */

const zoneOption = (zone: TimeZoneChoice): { timeZone?: string } =>
  zone === 'utc' ? { timeZone: 'UTC' } : {};

/** `09:14:32`, 24 hours with seconds, in the chosen zone. */
export function formatEventClock(ms: number, zone: TimeZoneChoice): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...zoneOption(zone),
  }).format(new Date(ms));
}

/** `09:14`, for the axis of the strip. */
export function formatEventMinute(ms: number, zone: TimeZoneChoice): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...zoneOption(zone),
  }).format(new Date(ms));
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The value of a `datetime-local` field for a moment: `2026-10-20T09:15`, in the chosen zone. */
export function toInputValue(ms: number, zone: TimeZoneChoice): string {
  const date = new Date(ms);
  if (zone === 'utc') return date.toISOString().slice(0, 16);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The moment a `datetime-local` value means in the chosen zone, or `null` for a value that is not a time (the field
 * is empty while it is being typed).
 */
export function fromInputValue(value: string, zone: TimeZoneChoice): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = zone === 'utc' ? Date.parse(`${value}:00Z`) : new Date(`${value}:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

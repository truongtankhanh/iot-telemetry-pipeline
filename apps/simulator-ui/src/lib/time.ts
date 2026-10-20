/** `09:14:32` in the viewer's time zone (or the one given): 24 hours, seconds, no date. */
export function formatClockTime(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(ms));
}

/** `ISO 8601` for a `<time dateTime>`. */
export const isoTime = (ms: number): string => new Date(ms).toISOString();

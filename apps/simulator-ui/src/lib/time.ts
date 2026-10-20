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

/**
 * How long ago, for a column of "last seen": `2 s ago`, `5 min ago`, and the clock time once it is an hour or more.
 * A time in the future (the two clocks differ by a moment) is "just now".
 */
export function formatAgo(ms: number, now: number): string {
  const seconds = Math.floor((now - ms) / 1000);
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return formatClockTime(ms);
}

/** `ISO 8601` for a `<time dateTime>`. */
export const isoTime = (ms: number): string => new Date(ms).toISOString();

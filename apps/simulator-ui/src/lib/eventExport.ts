import type { EventRow } from './eventRows';
import type { RangeId } from './eventRows';

/**
 * The export of the event timeline: the rows that pass the filter, all of them and not only the page on show, as CSV.
 * Times are ISO 8601 in UTC whatever the table shows (Local or UTC), so a file means the same moments wherever it is
 * opened. The file is made in the browser from what the page already holds; nothing is asked of the simulator.
 */

export const CSV_HEADER = [
  'id',
  'time (UTC)',
  'source',
  'kind',
  'message',
  'device',
  'rule',
  'alert',
  'scenario',
] as const;

/**
 * One CSV field: quoted when it holds a comma, a quote or a line break. A field that a spreadsheet would read as a
 * formula (it starts with `=`, `+`, `-` or `@`, or a control character) gets a leading apostrophe, the usual defence
 * against CSV injection; the messages are made of ids and titles from the registry and the rules, but it costs nothing.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const joined = (values: readonly string[]) => values.join('; ');

/** The rows as CSV: a header, then one line each, CRLF between lines as the format asks. */
export function eventsToCsv(rows: readonly EventRow[]): string {
  const lines = rows.map((row) =>
    [
      String(row.id),
      Number.isFinite(row.at) && row.at > 0 ? new Date(row.at).toISOString() : '',
      row.source,
      row.kind,
      row.message,
      joined(row.devices),
      joined(row.rules),
      joined(row.alerts),
      joined(row.scenarios),
    ]
      .map(csvCell)
      .join(','),
  );
  return [CSV_HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}

/** `studio-events-1h.csv`, `studio-events-custom.csv`. */
export const exportFileName = (range: RangeId): string => `studio-events-${range}.csv`;

/** What a download needs of the browser, so a test can pass its own. */
export interface DownloadHost {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createLink(): { href: string; download: string; click(): void };
}

/** The browser's own. */
export const browserDownload: DownloadHost = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createLink: () => document.createElement('a'),
};

/**
 * Hands a text to the person as a file: an object URL, a click on a link that has a `download` name, and the URL
 * revoked at once. A download is a navigation and not a request, so the page's Content-Security-Policy
 * (`connect-src 'self'`) does not apply to it; that is expected and is checked in a browser by hand.
 */
export function downloadText(
  name: string,
  content: string,
  type = 'text/csv;charset=utf-8',
  host: DownloadHost = browserDownload,
): void {
  const url = host.createObjectURL(new Blob([content], { type }));
  try {
    const link = host.createLink();
    link.href = url;
    link.download = name;
    link.click();
  } finally {
    host.revokeObjectURL(url);
  }
}

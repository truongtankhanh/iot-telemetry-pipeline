import { METRIC_NAMES, type MetricName } from '@itp/telemetry-contract';
import type { MessageRow } from './messageRows';
import { clampPage, PAGE_SIZES, pageCount } from './paging';

/**
 * What the address says about the Event stream: the filters (text, device, metric), the page and its size, and the
 * message whose detail is open. The page is a view of a list that changes every second, so the address keeps what a
 * person chose, not what the list holds.
 */
export interface MessageQuery {
  /** Matches the topic or the payload, ignoring case. */
  q: string;
  device: string | null;
  metric: MetricName | null;
  /** 1-based. */
  page: number;
  size: number;
  /** The simulator's id of the message whose detail is open. */
  message: number | null;
}

export const MESSAGE_SIZES = PAGE_SIZES;
export const DEFAULT_MESSAGE_SIZE = 10;

export const DEFAULT_MESSAGE_QUERY: MessageQuery = {
  q: '',
  device: null,
  metric: null,
  page: 1,
  size: DEFAULT_MESSAGE_SIZE,
  message: null,
};

/** The longest filter kept: a line, not a document. */
const FILTER_MAX_LENGTH = 200;

export interface ParsedMessageQuery extends MessageQuery {
  /**
   * The address carries a `topic` parameter, which the command palette has always written (`/events?topic=<topic>`). It
   * is read as the text filter when there is none, and the page rewrites the address without it.
   */
  aliased: boolean;
}

const isMetric = (value: string | null): value is MetricName =>
  value !== null && (METRIC_NAMES as readonly string[]).includes(value);

/**
 * Reads the address. A value that is not one of the allowed ones falls back to the default instead of failing: a link
 * shared with an old or hand-edited address still opens the page. A page past the end is clamped by the table, which
 * knows the total.
 */
export function parseMessageQuery(params: URLSearchParams): ParsedMessageQuery {
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const message = Number(params.get('message'));
  const metric = params.get('metric');
  const own = params.get('q') ?? '';
  const topic = params.get('topic');
  const text = own !== '' ? own : (topic ?? '');
  return {
    q: text.slice(0, FILTER_MAX_LENGTH),
    device: params.get('device') || null,
    metric: isMetric(metric) ? metric : null,
    page: Number.isInteger(page) && page >= 1 ? page : DEFAULT_MESSAGE_QUERY.page,
    size: (MESSAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_MESSAGE_SIZE,
    message: Number.isSafeInteger(message) && message >= 1 ? message : null,
    aliased: topic !== null,
  };
}

/** The address for a query: a parameter with its default is not written, and `topic` never is. */
export function serializeMessageQuery(query: MessageQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q !== '') params.set('q', query.q);
  if (query.device) params.set('device', query.device);
  if (query.metric) params.set('metric', query.metric);
  if (query.page !== 1) params.set('page', String(query.page));
  if (query.size !== DEFAULT_MESSAGE_SIZE) params.set('size', String(query.size));
  if (query.message !== null) params.set('message', String(query.message));
  return params;
}

/** The rows that pass the filters, in the order they came. An unreadable payload never matches a metric. */
export function filterRows(
  rows: readonly MessageRow[],
  query: Pick<MessageQuery, 'q' | 'device' | 'metric'>,
): MessageRow[] {
  const text = query.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (query.device !== null && row.deviceId !== query.device) return false;
    if (query.metric !== null && !row.metrics.some((m) => m.name === query.metric)) return false;
    if (text === '') return true;
    return row.topic.toLowerCase().includes(text) || row.payload.toLowerCase().includes(text);
  });
}

export interface MessagePage {
  rows: MessageRow[];
  /** The page shown: the one asked for, clamped to the pages there are. */
  page: number;
  count: number;
  total: number;
}

export function pageRows(
  rows: readonly MessageRow[],
  query: Pick<MessageQuery, 'page' | 'size'>,
): MessagePage {
  const count = pageCount(rows.length, query.size);
  const page = clampPage(query.page, count);
  const from = (page - 1) * query.size;
  return { rows: rows.slice(from, from + query.size), page, count, total: rows.length };
}

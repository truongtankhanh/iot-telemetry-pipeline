import {
  EVENT_SOURCES,
  type EventSelection,
  type EventSource,
  RANGE_IDS,
  type RangeId,
} from './eventRows';

/**
 * What the address says about the Overview's event timeline: the page and its size, the range (relative, or custom
 * with its two bounds), the filter and the source. It is the shape of Q6; the graph's and the controls' parameters
 * (`gq`, `group`, `problems`, `scenario`) are the page's and are left alone here.
 */
export interface EventQuery extends EventSelection {
  /** 1-based. */
  page: number;
  size: number;
}

export const EVENT_SIZES = [10, 25, 50, 100] as const;

export const DEFAULT_EVENT_QUERY: EventQuery = {
  page: 1,
  size: 10,
  range: '1h',
  from: null,
  to: null,
  q: '',
  source: 'all',
};

/** The parameters the timeline writes; a parameter with its default is not written. */
export const EVENT_PARAMS = ['page', 'size', 'range', 'from', 'to', 'q', 'source'] as const;

/** The longest filter kept: a line, not a document. */
const FILTER_MAX_LENGTH = 200;

const isRange = (value: string | null): value is RangeId =>
  value !== null && (RANGE_IDS as readonly string[]).includes(value);
const isSource = (value: string | null): value is EventSource =>
  value !== null && (EVENT_SOURCES as readonly string[]).includes(value);

/** An ISO 8601 time as ms, or `null` for anything else (a hand-edited address must not break the page). */
function time(value: string | null): number | null {
  if (value === null || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Reads the address. A value that is not one of the allowed ones falls back to the default instead of failing: a link
 * shared with an old or hand-edited address still opens the page. A custom range needs both bounds, in order; without
 * them it is the default range. The bounds mean nothing for a relative range and are dropped. A page past the end is
 * clamped by the table, which knows the total.
 */
export function readEventQuery(params: URLSearchParams): EventQuery {
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const requested = params.get('range');
  const from = time(params.get('from'));
  const to = time(params.get('to'));
  const custom = requested === 'custom' && from !== null && to !== null && from < to;
  const source = params.get('source');
  return {
    page: Number.isInteger(page) && page >= 1 ? page : DEFAULT_EVENT_QUERY.page,
    size: (EVENT_SIZES as readonly number[]).includes(size) ? size : DEFAULT_EVENT_QUERY.size,
    range: custom ? 'custom' : isRange(requested) && requested !== 'custom' ? requested : '1h',
    from: custom ? from : null,
    to: custom ? to : null,
    q: (params.get('q') ?? '').slice(0, FILTER_MAX_LENGTH),
    source: isSource(source) ? source : 'all',
  };
}

/** Sets or takes out one parameter. */
function write(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null || value === '') params.delete(key);
  else params.set(key, value);
}

/**
 * Puts the timeline's query into `params`, only what differs from the default, and leaves every other parameter as
 * it is. The bounds are ISO 8601 in UTC, so a link means the same moments wherever it is opened.
 */
export function writeEventQuery(params: URLSearchParams, query: EventQuery): URLSearchParams {
  const next = new URLSearchParams(params);
  const defaults = DEFAULT_EVENT_QUERY;
  const custom = query.range === 'custom' && query.from !== null && query.to !== null;
  write(next, 'page', query.page > defaults.page ? String(query.page) : null);
  write(next, 'size', query.size !== defaults.size ? String(query.size) : null);
  write(next, 'range', query.range !== defaults.range ? query.range : null);
  write(next, 'from', custom ? new Date(query.from as number).toISOString() : null);
  write(next, 'to', custom ? new Date(query.to as number).toISOString() : null);
  write(next, 'q', query.q);
  write(next, 'source', query.source !== 'all' ? query.source : null);
  return next;
}

import { describe, expect, it } from 'vitest';
import type { PublishedMessage } from '../api/types';
import { toRow } from './messageRows';
import {
  DEFAULT_MESSAGE_QUERY,
  filterRows,
  MESSAGE_SIZES,
  type MessageQuery,
  pageRows,
  parseMessageQuery,
  serializeMessageQuery,
} from './messageQuery';

const params = (text: string) => new URLSearchParams(text);

describe('parseMessageQuery', () => {
  it('has the defaults for an empty address', () => {
    expect(parseMessageQuery(params(''))).toEqual({ ...DEFAULT_MESSAGE_QUERY, aliased: false });
  });

  it('reads every parameter it writes', () => {
    const query: MessageQuery = {
      q: 'dc-env',
      device: 'dc-env-01',
      metric: 'humidity_pct',
      page: 3,
      size: 50,
      message: 1284,
    };
    expect(parseMessageQuery(serializeMessageQuery(query))).toEqual({ ...query, aliased: false });
  });

  it('falls back to the default for a value it cannot use', () => {
    const parsed = parseMessageQuery(params('page=0&size=7&metric=speed&message=abc&device='));
    expect(parsed).toEqual({ ...DEFAULT_MESSAGE_QUERY, aliased: false });
    expect(parseMessageQuery(params('page=2.5&message=-3&message=0')).page).toBe(1);
    expect(parseMessageQuery(params('message=0')).message).toBeNull();
    expect(parseMessageQuery(params('message=1.5')).message).toBeNull();
    expect(parseMessageQuery(params('page=abc')).page).toBe(1);
  });

  it('allows the sizes of every numbered pager', () => {
    for (const size of MESSAGE_SIZES) {
      expect(parseMessageQuery(params(`size=${size}`)).size).toBe(size);
    }
  });

  it('takes every metric of the contract and no other', () => {
    expect(parseMessageQuery(params('metric=temperature_c')).metric).toBe('temperature_c');
    expect(parseMessageQuery(params('metric=power_kw')).metric).toBe('power_kw');
    expect(parseMessageQuery(params('metric=TEMPERATURE_C')).metric).toBeNull();
  });

  it('keeps a filter to a line', () => {
    expect(parseMessageQuery(params(`q=${'x'.repeat(500)}`)).q).toHaveLength(200);
  });

  it('reads the command palette’s topic as the text filter, and says it was an alias', () => {
    const parsed = parseMessageQuery(params('topic=campus/BLD-DC/dc-env-01/telemetry'));
    expect(parsed.q).toBe('campus/BLD-DC/dc-env-01/telemetry');
    expect(parsed.aliased).toBe(true);
  });

  it('does not let topic override a filter that is there, but still reports it', () => {
    const parsed = parseMessageQuery(params('q=mine&topic=other'));
    expect(parsed.q).toBe('mine');
    expect(parsed.aliased).toBe(true);
  });
});

describe('serializeMessageQuery', () => {
  it('writes nothing for the defaults', () => {
    expect(serializeMessageQuery(DEFAULT_MESSAGE_QUERY).toString()).toBe('');
  });

  it('writes only what differs, and never topic', () => {
    const text = serializeMessageQuery({
      ...DEFAULT_MESSAGE_QUERY,
      q: 'a b',
      page: 2,
      message: 5,
    }).toString();
    expect(text).toBe('q=a+b&page=2&message=5');
    expect(text).not.toContain('topic');
  });
});

const message = (id: number, overrides: Partial<PublishedMessage> = {}): PublishedMessage => ({
  id,
  at: '2026-10-19T02:14:31.000Z',
  ackMs: 3,
  deviceId: 'dc-env-01',
  topic: 'campus/BLD-DC/dc-env-01/telemetry',
  payload: JSON.stringify({ seq: id, metrics: { temperature_c: 20 + id } }),
  seq: id,
  ts: '2026-10-19T02:14:31.000Z',
  ...overrides,
});

const rows = (messages: PublishedMessage[]) =>
  messages.map((m) => {
    const row = toRow(m);
    if (row === null) throw new Error('expected a row');
    return row;
  });

const LIST = rows([
  message(5, { deviceId: 'lib-air-01', topic: 'campus/BLD-LIB/lib-air-01/telemetry' }),
  message(4, {
    payload: JSON.stringify({ metrics: { humidity_pct: 45, temperature_c: 22 } }),
  }),
  message(3, { payload: 'not json at all' }),
  message(2, { deviceId: 'dc-env-02', topic: 'campus/BLD-DC/dc-env-02/telemetry' }),
  message(1),
]);

const ids = (list: { id: number }[]) => list.map((r) => r.id);
const none = { q: '', device: null, metric: null } as const;

describe('filterRows', () => {
  it('keeps everything, in order, with no filter', () => {
    expect(ids(filterRows(LIST, none))).toEqual([5, 4, 3, 2, 1]);
  });

  it('matches the text in the topic or the payload, ignoring case', () => {
    expect(ids(filterRows(LIST, { ...none, q: 'BLD-LIB' }))).toEqual([5]);
    expect(ids(filterRows(LIST, { ...none, q: 'humidity' }))).toEqual([4]);
    expect(ids(filterRows(LIST, { ...none, q: 'NOT JSON' }))).toEqual([3]);
    expect(ids(filterRows(LIST, { ...none, q: '  dc-env-02  ' }))).toEqual([2]);
    expect(ids(filterRows(LIST, { ...none, q: 'nothing like this' }))).toEqual([]);
  });

  it('filters by device', () => {
    expect(ids(filterRows(LIST, { ...none, device: 'dc-env-01' }))).toEqual([4, 3, 1]);
    expect(ids(filterRows(LIST, { ...none, device: 'nobody' }))).toEqual([]);
  });

  it('filters by a metric the payload has, and never matches an unreadable payload', () => {
    expect(ids(filterRows(LIST, { ...none, metric: 'temperature_c' }))).toEqual([5, 4, 2, 1]);
    expect(ids(filterRows(LIST, { ...none, metric: 'humidity_pct' }))).toEqual([4]);
    expect(ids(filterRows(LIST, { ...none, metric: 'co2_ppm' }))).toEqual([]);
  });

  it('combines the filters', () => {
    expect(
      ids(filterRows(LIST, { q: 'campus', device: 'dc-env-01', metric: 'temperature_c' })),
    ).toEqual([4, 1]);
  });
});

describe('pageRows', () => {
  const many = rows(Array.from({ length: 25 }, (_, i) => message(25 - i)));

  it('cuts a page', () => {
    const first = pageRows(many, { page: 1, size: 10 });
    expect(ids(first.rows)).toEqual([25, 24, 23, 22, 21, 20, 19, 18, 17, 16]);
    expect(first).toMatchObject({ page: 1, count: 3, total: 25 });
    expect(ids(pageRows(many, { page: 3, size: 10 }).rows)).toEqual([5, 4, 3, 2, 1]);
  });

  it('clamps a page past the end to the last one', () => {
    const past = pageRows(many, { page: 99, size: 10 });
    expect(past.page).toBe(3);
    expect(ids(past.rows)).toEqual([5, 4, 3, 2, 1]);
  });

  it('is one empty page for no rows', () => {
    expect(pageRows([], { page: 4, size: 25 })).toEqual({ rows: [], page: 1, count: 1, total: 0 });
  });
});

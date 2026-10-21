import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_QUERY, readEventQuery, writeEventQuery } from './eventQuery';

const read = (search: string) => readEventQuery(new URLSearchParams(search));
const FROM = '2026-10-20T08:15:00.000Z';
const TO = '2026-10-20T09:15:00.000Z';

describe('reading the address', () => {
  it('is the default for a plain address', () => {
    expect(read('')).toEqual(DEFAULT_EVENT_QUERY);
  });

  it('reads the page, the size, the range, the filter and the source', () => {
    expect(read('page=3&size=25&range=3h&q=device%3Adc-env-01&source=Alert')).toEqual({
      page: 3,
      size: 25,
      range: '3h',
      from: null,
      to: null,
      q: 'device:dc-env-01',
      source: 'Alert',
    });
  });

  it('reads a source with a space in it', () => {
    expect(read('source=Command%20Center').source).toBe('Command Center');
  });

  it('falls back to the default for a value that is not allowed, so a shared link still opens', () => {
    expect(read('page=0').page).toBe(1);
    expect(read('page=-4').page).toBe(1);
    expect(read('page=2.5').page).toBe(1);
    expect(read('page=abc').page).toBe(1);
    expect(read('size=7').size).toBe(10);
    expect(read('size=1000').size).toBe(10);
    expect(read('range=1y').range).toBe('1h');
    expect(read('source=Everything').source).toBe('all');
  });

  it('reads a custom range with both bounds, as the moments they are', () => {
    const query = read(`range=custom&from=${FROM}&to=${TO}`);
    expect(query).toMatchObject({ range: 'custom', from: Date.parse(FROM), to: Date.parse(TO) });
  });

  it('turns a custom range that cannot be one into the default range', () => {
    for (const search of [
      'range=custom',
      `range=custom&from=${FROM}`,
      `range=custom&to=${TO}`,
      `range=custom&from=${TO}&to=${FROM}`,
      `range=custom&from=${FROM}&to=${FROM}`,
      'range=custom&from=yesterday&to=today',
    ]) {
      expect(read(search), search).toMatchObject({ range: '1h', from: null, to: null });
    }
  });

  it('drops the bounds of a relative range', () => {
    expect(read(`range=30m&from=${FROM}&to=${TO}`)).toMatchObject({
      range: '30m',
      from: null,
      to: null,
    });
  });

  it('keeps no more of the filter than a line', () => {
    expect(read(`q=${'x'.repeat(500)}`).q).toHaveLength(200);
  });
});

describe('writing the address', () => {
  const write = (patch: Partial<typeof DEFAULT_EVENT_QUERY>, base = '') =>
    writeEventQuery(new URLSearchParams(base), { ...DEFAULT_EVENT_QUERY, ...patch }).toString();

  it('writes nothing for the default', () => {
    expect(write({})).toBe('');
  });

  it('writes only what differs', () => {
    expect(write({ page: 2 })).toBe('page=2');
    expect(write({ size: 50, range: '5m' })).toBe('size=50&range=5m');
    expect(write({ q: 'hot', source: 'Outbox' })).toBe('q=hot&source=Outbox');
  });

  it('writes the bounds of a custom range in UTC, and nothing for a relative one', () => {
    expect(write({ range: 'custom', from: Date.parse(FROM), to: Date.parse(TO) })).toBe(
      `range=custom&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    );
    expect(write({ range: '3h', from: Date.parse(FROM), to: Date.parse(TO) })).toBe('range=3h');
  });

  it('takes a parameter out when the query goes back to its default', () => {
    expect(write({}, 'page=4&size=50&range=3h&q=x&source=Alert')).toBe('');
  });

  it('leaves the parameters of the rest of the page as they are', () => {
    expect(write({ page: 2 }, 'scenario=a&gq=air&group=zone&problems=1')).toBe(
      'scenario=a&gq=air&group=zone&problems=1&page=2',
    );
    expect(write({}, 'scenario=a&page=2')).toBe('scenario=a');
  });

  it('round-trips through the address', () => {
    const query = {
      ...DEFAULT_EVENT_QUERY,
      page: 3,
      size: 25,
      range: 'custom' as const,
      from: Date.parse(FROM),
      to: Date.parse(TO),
      q: 'source:Alert hot',
      source: 'Outbox' as const,
    };
    expect(readEventQuery(writeEventQuery(new URLSearchParams(), query))).toEqual(query);
  });
});

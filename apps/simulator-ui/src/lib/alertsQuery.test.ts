import { describe, expect, it } from 'vitest';
import {
  ALERT_PAGE_SIZES,
  DEFAULT_ALERT_PAGE_SIZE,
  DEFAULT_ALERTS_QUERY,
  parseAlertsQuery,
  serializeAlertsQuery,
} from './alertsQuery';

const parse = (search: string) => parseAlertsQuery(new URLSearchParams(search));

describe('the address of the Alerts page', () => {
  it('is the default for a plain address, and a plain address for the default', () => {
    expect(parse('')).toEqual(DEFAULT_ALERTS_QUERY);
    expect(serializeAlertsQuery(DEFAULT_ALERTS_QUERY).toString()).toBe('');
  });

  it('reads and writes each part, and only what differs from the default', () => {
    const query = parse('status=open&severity=high&size=50&alert=7');
    expect(query).toEqual({ status: 'open', severity: 'high', size: 50, alert: '7' });
    expect(serializeAlertsQuery(query).toString()).toBe(
      'status=open&severity=high&size=50&alert=7',
    );
    expect(
      serializeAlertsQuery({ ...query, size: DEFAULT_ALERT_PAGE_SIZE }).get('size'),
    ).toBeNull();
  });

  it('falls back to the default for a value it does not know', () => {
    expect(parse('status=closed&severity=urgent&size=7')).toEqual(DEFAULT_ALERTS_QUERY);
    expect(parse('size=abc').size).toBe(DEFAULT_ALERT_PAGE_SIZE);
    expect(parse('size=5000').size).toBe(DEFAULT_ALERT_PAGE_SIZE);
  });

  it('allows every size from 5 to 200 and nothing else', () => {
    expect([...ALERT_PAGE_SIZES]).toEqual([5, 10, 25, 50, 100, 200]);
    for (const size of ALERT_PAGE_SIZES) expect(parse(`size=${size}`).size).toBe(size);
  });

  it('cuts a very long alert id and treats an empty one as none', () => {
    expect(parse(`alert=${'9'.repeat(200)}`).alert).toBe('9'.repeat(40));
    expect(parse('alert=').alert).toBeNull();
  });

  it('has no cursor: a reload opens the newest alerts', () => {
    expect(Object.keys(DEFAULT_ALERTS_QUERY)).not.toContain('before');
    expect(parse('before=abc')).toEqual(DEFAULT_ALERTS_QUERY);
  });
});

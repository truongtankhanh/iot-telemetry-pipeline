import { describe, expect, it } from 'vitest';
import { formatEventClock, formatEventMinute, fromInputValue, toInputValue } from './eventTime';

const MOMENT = Date.parse('2026-10-20T09:14:32.000Z');

describe('the clock of a row', () => {
  it('is the time in UTC when asked for UTC', () => {
    expect(formatEventClock(MOMENT, 'utc')).toBe('09:14:32');
    expect(formatEventMinute(MOMENT, 'utc')).toBe('09:14');
  });

  it('is the time in the viewer’s zone otherwise, as the rest of Studio writes it', () => {
    const local = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(MOMENT));
    expect(formatEventClock(MOMENT, 'local')).toBe(local);
  });
});

describe('the value of a custom range field', () => {
  it('writes a moment to the minute, in the chosen zone', () => {
    expect(toInputValue(MOMENT, 'utc')).toBe('2026-10-20T09:14');
    expect(toInputValue(MOMENT, 'local')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('reads it back to the same minute, in either zone', () => {
    for (const zone of ['utc', 'local'] as const) {
      const minute = Math.floor(MOMENT / 60_000) * 60_000;
      expect(fromInputValue(toInputValue(MOMENT, zone), zone), zone).toBe(minute);
    }
  });

  it('means UTC in UTC: the same text is another moment in another zone', () => {
    expect(fromInputValue('2026-10-20T09:15', 'utc')).toBe(Date.parse('2026-10-20T09:15:00.000Z'));
  });

  it('is null for what is not a time, and for a field still being typed', () => {
    for (const value of ['', '2026-10-20', '2026-10-20T09', 'yesterday', '2026-13-45T25:61']) {
      expect(fromInputValue(value, 'utc'), value).toBeNull();
    }
  });
});

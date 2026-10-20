import { describe, expect, it } from 'vitest';
import { formatClockTime, isoTime } from './time';

const MOMENT = Date.parse('2026-10-20T09:14:32.000Z');

describe('formatClockTime', () => {
  it('writes hours, minutes and seconds on 24 hours, in the zone asked for', () => {
    expect(formatClockTime(MOMENT, 'UTC')).toBe('09:14:32');
    expect(formatClockTime(MOMENT, 'Asia/Ho_Chi_Minh')).toBe('16:14:32');
  });

  it('pads and does not use am or pm', () => {
    expect(formatClockTime(Date.parse('2026-10-20T01:02:03.000Z'), 'UTC')).toBe('01:02:03');
    expect(formatClockTime(Date.parse('2026-10-20T15:00:00.000Z'), 'UTC')).toBe('15:00:00');
  });

  it('reads the zone of the viewer when none is given', () => {
    expect(formatClockTime(MOMENT)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe('isoTime', () => {
  it('is ISO 8601 in UTC', () => {
    expect(isoTime(MOMENT)).toBe('2026-10-20T09:14:32.000Z');
  });
});

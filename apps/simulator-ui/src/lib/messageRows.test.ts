import { describe, expect, it } from 'vitest';
import type { PublishedMessage } from '../api/types';
import { toRow } from './messageRows';

const PAYLOAD = JSON.stringify({
  seq: 1284,
  ts: '2026-10-19T02:14:31.012Z',
  metrics: { temperature_c: 29.3, humidity_pct: 45.1 },
});

const message = (overrides: Partial<PublishedMessage> = {}): PublishedMessage => ({
  id: 7,
  at: '2026-10-19T02:14:31.012Z',
  ackMs: 3.1,
  deviceId: 'dc-env-01',
  topic: 'campus/BLD-DC/dc-env-01/telemetry',
  payload: PAYLOAD,
  seq: 1284,
  ts: '2026-10-19T02:14:31.012Z',
  ...overrides,
});

/** A message that lacks a field the type makes optional, as an older simulator would send it. */
function without(field: 'id' | 'at' | 'ackMs', overrides: Partial<PublishedMessage> = {}) {
  const copy: Partial<PublishedMessage> = message(overrides);
  delete copy[field];
  return copy as PublishedMessage;
}

const row = (overrides: Partial<PublishedMessage> = {}) => {
  const result = toRow(message(overrides), { timeZone: 'UTC' });
  if (result === null) throw new Error('expected a row');
  return result;
};

describe('toRow', () => {
  it('works out what the table shows for a normal message', () => {
    const r = row();
    expect(r).toMatchObject({
      id: 7,
      deviceId: 'dc-env-01',
      seq: 1284,
      topic: 'campus/BLD-DC/dc-env-01/telemetry',
      time: '02:14:31.012',
      summary: 'temperature_c 29.3 · humidity_pct 45.1',
      readable: true,
      sizeBytes: PAYLOAD.length,
      ackMs: 3.1,
      tag: null,
      fault: null,
    });
    expect(r.metrics).toEqual([
      { name: 'temperature_c', value: 29.3 },
      { name: 'humidity_pct', value: 45.1 },
    ]);
    expect(r.atMs).toBe(Date.parse('2026-10-19T02:14:31.012Z'));
  });

  it('shows the time of the acknowledgement, not the payload’s, and falls back to the payload’s', () => {
    expect(row({ at: '2026-10-23T08:00:00.500Z', ts: '2026-10-01T05:00:00.000Z' }).time).toBe(
      '08:00:00.500',
    );
    expect(
      toRow(without('at', { ts: '2026-10-01T05:00:07.040Z' }), { timeZone: 'UTC' })?.time,
    ).toBe('05:00:07.040');
    expect(row({ at: 'not a time', ts: 'nor this' }).time).toBe('—');
    expect(row({ at: 'not a time', ts: 'nor this' }).atMs).toBeNull();
  });

  it('pads the milliseconds', () => {
    expect(row({ at: '2026-10-19T02:14:31.007Z' }).time).toBe('02:14:31.007');
    expect(row({ at: '2026-10-19T02:14:31.000Z' }).time).toBe('02:14:31.000');
  });

  it('measures the size in bytes, not characters', () => {
    const payload = JSON.stringify({ seq: 1, ts: 'é😀', metrics: { temperature_c: 1 } });
    const r = row({ payload });
    expect(r.sizeBytes).toBe(new TextEncoder().encode(payload).length);
    expect(r.sizeBytes).toBeGreaterThan(payload.length);
  });

  it('shows a payload it cannot read as it is, cut at a line, and says it is not readable', () => {
    for (const payload of [
      'not json {',
      '[1, 2, 3]',
      '42',
      'null',
      JSON.stringify({ seq: 1 }),
      JSON.stringify({ metrics: {} }),
      JSON.stringify({ metrics: { temperature_c: 'hot' } }),
      JSON.stringify({ metrics: [1, 2] }),
    ]) {
      const r = row({ payload });
      expect(r.readable, payload).toBe(false);
      expect(r.metrics, payload).toEqual([]);
      expect(r.summary, payload).toBe(payload);
    }
    const long = row({ payload: `{"x": "${'a'.repeat(200)}"` });
    expect(long.summary.length).toBe(81);
    expect(long.summary.endsWith('…')).toBe(true);
  });

  it('keeps the readable metrics of a payload that also has others', () => {
    const r = row({
      payload: JSON.stringify({ metrics: { temperature_c: 1, note: 'x', humidity_pct: null } }),
    });
    expect(r.readable).toBe(true);
    expect(r.summary).toBe('temperature_c 1');
  });

  it('marks each kind of message that is not a plain one', () => {
    expect(row({ fault: 'duplicate' }).tag).toBe('duplicate');
    expect(row({ fault: 'burst' }).tag).toBe('burst');
    expect(row({ fault: 'republish' }).tag).toBe('republish');
    const malformed = row({ fault: 'malformed:range' });
    expect(malformed.tag).toBe('malformed');
    expect(malformed.fault).toBe('malformed:range');
  });

  it('indents a payload that is a JSON object, and only then', () => {
    expect(row().pretty).toBe(JSON.stringify(JSON.parse(PAYLOAD), null, 2));
    expect(row({ payload: '[1]' }).pretty).toBeNull();
    expect(row({ payload: 'nope' }).pretty).toBeNull();
    // An object without metrics is still an object worth indenting.
    expect(row({ payload: '{"a":1}' }).pretty).toBe('{\n  "a": 1\n}');
  });

  it('has no PUBACK time when the simulator did not give one', () => {
    expect(toRow(without('ackMs'), { timeZone: 'UTC' })?.ackMs).toBeNull();
  });

  it('gives no row to a message without a numeric id', () => {
    expect(toRow(without('id'))).toBeNull();
    expect(toRow({ ...message(), id: 'x' as unknown as number })).toBeNull();
    expect(toRow({ ...message(), id: Number.NaN })).toBeNull();
  });
});

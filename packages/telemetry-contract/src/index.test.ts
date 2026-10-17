import { describe, expect, it } from 'vitest';
import {
  MAX_PAYLOAD_BYTES,
  METRIC_NAMES,
  METRICS,
  parsePayload,
  parseTopic,
  telemetryTopic,
  withShareGroup,
} from './index';

describe('topics', () => {
  it('builds and parses the telemetry topic', () => {
    const topic = telemetryTopic({ zoneCode: 'BLD-DC', deviceId: 'dc-env-01' });
    expect(topic).toBe('campus/BLD-DC/dc-env-01/telemetry');
    expect(parseTopic(topic)).toEqual({
      ok: true,
      value: { zoneCode: 'BLD-DC', deviceId: 'dc-env-01' },
    });
  });

  it.each(['campus/BLD-DC/telemetry', 'site/BLD-DC/x/telemetry', 'campus/BLD DC/x/telemetry'])(
    'rejects %s',
    (topic) => expect(parseTopic(topic)).toEqual({ ok: false, reason: 'topic' }),
  );

  it('prefixes a shared-subscription group only when one is given', () => {
    expect(withShareGroup('campus/+/+/telemetry', 'ingest')).toBe(
      '$share/ingest/campus/+/+/telemetry',
    );
    expect(withShareGroup('campus/+/+/telemetry')).toBe('campus/+/+/telemetry');
  });
});

describe('parsePayload', () => {
  const valid = { seq: 1, ts: '2026-10-01T08:00:00Z', metrics: { temperature_c: 24.5 } };

  it('accepts a valid payload and normalises the timestamp', () => {
    expect(parsePayload(JSON.stringify(valid))).toEqual({
      ok: true,
      value: { ...valid, ts: '2026-10-01T08:00:00.000Z' },
    });
  });

  it.each([
    ['not json', '{', 'json'],
    ['negative seq', { ...valid, seq: -1 }, 'seq'],
    // Not valid JSON on purpose: the reason is `size`, not `json`, so the size check runs first.
    ['payload over the size limit', 'x'.repeat(MAX_PAYLOAD_BYTES + 1), 'size'],
    ['bad timestamp', { ...valid, ts: 'yesterday' }, 'ts'],
    ['numeric timestamp', { ...valid, ts: 1_759_305_600_000 }, 'ts'],
    ['missing timestamp', { seq: 1, metrics: valid.metrics }, 'ts'],
    ['no metrics', { ...valid, metrics: {} }, 'empty'],
    ['unknown metric', { ...valid, metrics: { pressure_hpa: 1000 } }, 'metric'],
    [
      'metric named like Object.prototype.constructor',
      { ...valid, metrics: { constructor: 1 } },
      'metric',
    ],
    [
      'metric named like Object.prototype.toString',
      { ...valid, metrics: { toString: 1 } },
      'metric',
    ],
    [
      'metric named like Object.prototype.hasOwnProperty',
      { ...valid, metrics: { hasOwnProperty: 1 } },
      'metric',
    ],
    // Raw text: an object literal with `__proto__` would set the prototype and serialise to `{}`.
    [
      'metric named __proto__',
      '{"seq":1,"ts":"2026-10-01T08:00:00Z","metrics":{"__proto__":1}}',
      'metric',
    ],
    ['non-numeric value', { ...valid, metrics: { temperature_c: '24' } }, 'value'],
    ['out of range', { ...valid, metrics: { humidity_pct: 140 } }, 'range'],
  ])('rejects %s with reason %s', (_, input, reason) => {
    const raw = typeof input === 'string' ? input : JSON.stringify(input);
    expect(parsePayload(new TextEncoder().encode(raw))).toEqual({ ok: false, reason });
  });

  it.each([
    // Read as local time, or not a full timestamp, by Date.parse.
    ['a timestamp without a zone', '2026-10-01T08:00:00'],
    ['a date without a time', '2026-10-01'],
    ['a bare year', '2026'],
    ['a bare number', '1'],
    ['free text', 'Oct 1 2026'],
    ['leading whitespace', ' 2026-10-01T08:00:00Z'],
    ['a trailing newline', '2026-10-01T08:00:00Z\n'],
    ['a lowercase t', '2026-10-01t08:00:00Z'],
    ['a lowercase z', '2026-10-01T08:00:00z'],
    ['a space instead of T', '2026-10-01 08:00:00Z'],
    ['an offset without a colon', '2026-10-01T08:00:00+0700'],
    ['no seconds', '2026-10-01T08:00Z'],
    ['an empty fraction', '2026-10-01T08:00:00.Z'],
    ['a fraction of 10 digits', '2026-10-01T08:00:00.1234567890Z'],
    // Dates Date.parse accepts but rolls over to the next month.
    ['a day that rolls over (31 February)', '2026-02-31T00:00:00Z'],
    ['a day that rolls over (31 April)', '2026-04-31T00:00:00Z'],
    ['29 February of a common year', '2026-02-29T00:00:00Z'],
    ['29 February of a century year', '2100-02-29T00:00:00Z'],
    ['day zero', '2026-10-00T00:00:00Z'],
    ['month 13', '2026-13-01T00:00:00Z'],
    // Hour 24 is valid ISO 8601 and rolls over; minute, second and offset ranges rely on Date.parse.
    ['hour 24', '2026-10-01T24:00:00Z'],
    ['second 60', '2026-10-01T23:59:60Z'],
    ['an offset of 24 hours', '2026-10-01T08:00:00+24:00'],
    ['an offset of 60 minutes', '2026-10-01T08:00:00+07:60'],
  ])('rejects %s as ts', (_, ts) => {
    expect(parsePayload(JSON.stringify({ ...valid, ts }))).toEqual({ ok: false, reason: 'ts' });
  });

  it.each([
    ['Z', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00.000Z'],
    ['a positive offset', '2026-10-01T15:00:00+07:00', '2026-10-01T08:00:00.000Z'],
    ['a negative offset', '2026-10-01T03:00:00-05:00', '2026-10-01T08:00:00.000Z'],
    ['-00:00', '2026-10-01T08:00:00-00:00', '2026-10-01T08:00:00.000Z'],
    ['the largest offset', '2026-10-01T08:00:00+23:59', '2026-09-30T08:01:00.000Z'],
    ['1 fraction digit', '2026-10-01T08:00:00.1Z', '2026-10-01T08:00:00.100Z'],
    ['3 fraction digits', '2026-10-01T08:00:00.123Z', '2026-10-01T08:00:00.123Z'],
    [
      '6 fraction digits (truncated to ms)',
      '2026-10-01T08:00:00.123456Z',
      '2026-10-01T08:00:00.123Z',
    ],
    [
      '9 fraction digits (truncated to ms)',
      '2026-10-01T08:00:00.123456789Z',
      '2026-10-01T08:00:00.123Z',
    ],
    ['29 February of a leap year', '2028-02-29T00:00:00Z', '2028-02-29T00:00:00.000Z'],
    ['29 February of a leap century year', '2000-02-29T00:00:00Z', '2000-02-29T00:00:00.000Z'],
    // Fails if the day check is built on Date.UTC, which maps year 0 to 1900 (not a leap year).
    ['29 February of year 0', '0000-02-29T00:00:00Z', '0000-02-29T00:00:00.000Z'],
  ])('accepts %s and normalises it to UTC', (_, ts, expected) => {
    expect(parsePayload(JSON.stringify({ ...valid, ts }))).toMatchObject({
      ok: true,
      value: { ts: expected },
    });
  });

  it('normalises the Z form and the offset form of the same instant to the identical string', () => {
    const at = (ts: string) => parsePayload(JSON.stringify({ ...valid, ts }));
    expect(at('2026-10-01T15:00:00+07:00')).toEqual(at('2026-10-01T08:00:00Z'));
  });

  type Wrap = (text: string) => Uint8Array | string;
  const encode: Wrap = (text) => new TextEncoder().encode(text);
  const inputKinds: [string, Wrap][] = [
    ['a Uint8Array', encode],
    ['a string', (text) => text],
  ];
  // `valid` is ASCII, so its length in characters is its length in bytes.
  const paddedTo = (length: number) => {
    const json = JSON.stringify(valid);
    return json + ' '.repeat(length - json.length);
  };

  it.each(inputKinds)(
    'rejects %s one byte over the limit as size, before parsing it',
    (_, wrap) => {
      expect(parsePayload(wrap('x'.repeat(MAX_PAYLOAD_BYTES + 1)))).toEqual({
        ok: false,
        reason: 'size',
      });
    },
  );

  it.each(inputKinds)('does not reject %s of exactly the limit for its size', (_, wrap) => {
    expect(parsePayload(wrap('x'.repeat(MAX_PAYLOAD_BYTES)))).toEqual({
      ok: false,
      reason: 'json',
    });
  });

  it.each(inputKinds)('accepts a valid payload of exactly the limit as %s', (_, wrap) => {
    expect(parsePayload(wrap(paddedTo(MAX_PAYLOAD_BYTES)))).toMatchObject({ ok: true });
  });

  it.each(inputKinds)('rejects a valid payload one byte over the limit as %s', (_, wrap) => {
    expect(parsePayload(wrap(paddedTo(MAX_PAYLOAD_BYTES + 1)))).toEqual({
      ok: false,
      reason: 'size',
    });
  });

  it('counts bytes for a Uint8Array and UTF-16 units for a string', () => {
    // 2049 characters, 4098 bytes: over the limit as bytes, under it as a string length.
    const text = 'é'.repeat(MAX_PAYLOAD_BYTES / 2 + 1);
    expect(parsePayload(encode(text))).toEqual({ ok: false, reason: 'size' });
    expect(parsePayload(text)).toEqual({ ok: false, reason: 'json' });
  });

  it('keeps the largest legitimate message far below the limit', () => {
    const metrics = Object.fromEntries(METRIC_NAMES.map((name) => [name, METRICS[name].max / 3]));
    const largest = JSON.stringify(
      { seq: Number.MAX_SAFE_INTEGER, ts: '2026-10-01T08:00:00.123456789+07:00', metrics },
      null,
      4,
    );
    expect(parsePayload(largest)).toMatchObject({ ok: true });
    expect(new TextEncoder().encode(largest).byteLength).toBeLessThan(MAX_PAYLOAD_BYTES / 10);
  });

  it.each(METRIC_NAMES)('still accepts the known metric %s at its minimum', (name) => {
    const payload = { ...valid, metrics: { [name]: METRICS[name].min } };
    expect(parsePayload(JSON.stringify(payload))).toMatchObject({ ok: true });
  });
});

import { describe, expect, it } from 'vitest';
import { parsePayload, parseTopic, telemetryTopic, withShareGroup } from './index';

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
    ['bad timestamp', { ...valid, ts: 'yesterday' }, 'ts'],
    ['no metrics', { ...valid, metrics: {} }, 'empty'],
    ['unknown metric', { ...valid, metrics: { pressure_hpa: 1000 } }, 'metric'],
    ['non-numeric value', { ...valid, metrics: { temperature_c: '24' } }, 'value'],
    ['out of range', { ...valid, metrics: { humidity_pct: 140 } }, 'range'],
  ])('rejects %s with reason %s', (_, input, reason) => {
    const raw = typeof input === 'string' ? input : JSON.stringify(input);
    expect(parsePayload(new TextEncoder().encode(raw))).toEqual({ ok: false, reason });
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DeviceSpec, parseAnomaly, sample } from './signals.ts';

const dc: DeviceSpec = {
  id: 'dc-env-01',
  kind: 'server_room',
  zoneCode: 'BLD-DC',
  metrics: ['temperature_c'],
};
const noon = new Date('2026-10-01T05:00:00Z'); // 12:00 on campus (UTC+7)

describe('parseAnomaly', () => {
  it('parses device:metric:value:startAt:duration', () => {
    assert.deepEqual(parseAnomaly('dc-env-01:temperature_c:29.5:20:60'), {
      deviceId: 'dc-env-01',
      metric: 'temperature_c',
      value: 29.5,
      startAt: 20,
      duration: 60,
    });
  });

  it('rejects malformed specs', () => {
    assert.throws(() => parseAnomaly('dc-env-01:temperature_c:hot'), /Invalid anomaly/);
  });
});

describe('sample', () => {
  const anomaly = parseAnomaly('dc-env-01:temperature_c:29.5:20:60');

  it('stays near the baseline outside an anomaly', () => {
    const value = sample(dc, 'temperature_c', noon, 5, [anomaly], () => 0.5);
    assert.equal(value, 22.5);
  });

  it('holds the anomaly value while it is active, and only then', () => {
    assert.equal(
      sample(dc, 'temperature_c', noon, 30, [anomaly], () => 0.5),
      29.5,
    );
    assert.equal(
      sample(dc, 'temperature_c', noon, 80, [anomaly], () => 0.5),
      22.5,
    );
  });
});

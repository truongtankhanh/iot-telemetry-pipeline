import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Anomaly,
  type DeviceSpec,
  baselineValue,
  metricProfile,
  parseAnomaly,
  profilesOf,
  sample,
} from './signals.ts';

const dc: DeviceSpec = {
  id: 'dc-env-01',
  kind: 'server_room',
  zoneCode: 'BLD-DC',
  metrics: ['temperature_c'],
};
const air: DeviceSpec = {
  id: 'lha-air-01',
  kind: 'indoor_air',
  zoneCode: 'BLD-LHA',
  metrics: ['co2_ppm'],
};
const noon = new Date('2026-10-01T05:00:00Z'); // 12:00 on campus (UTC+7)
const night = new Date('2026-10-01T20:00:00Z'); // 03:00 on campus

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

  it('treats an anomaly without a shape as a step', () => {
    const step: Anomaly = { ...anomaly, shape: 'step' };
    for (const elapsed of [5, 20, 30, 79, 80]) {
      assert.equal(
        sample(dc, 'temperature_c', noon, elapsed, [step], () => 0.3),
        sample(dc, 'temperature_c', noon, elapsed, [anomaly], () => 0.3),
      );
    }
  });

  it('adds the baseline noise outside an anomaly', () => {
    // random() = 1 puts the noise at +noise (0.3 for a server room temperature).
    assert.equal(
      sample(dc, 'temperature_c', noon, 5, [], () => 1),
      22.8,
    );
  });
});

describe('sample with a ramp', () => {
  const ramp: Anomaly = { ...parseAnomaly('dc-env-01:temperature_c:30.5:20:60'), shape: 'ramp' };

  it('starts at the baseline, rises linearly and approaches the value by the end of the window', () => {
    const at = (elapsed: number) => sample(dc, 'temperature_c', noon, elapsed, [ramp], () => 0.5);
    assert.equal(at(20), 22.5);
    assert.equal(at(35), 24.5);
    assert.equal(at(50), 26.5);
    assert.equal(at(79), 30.4); // 22.5 + 8 * 59/60, rounded to one decimal
  });

  it('is back at the baseline once the window has ended, and before it starts', () => {
    assert.equal(
      sample(dc, 'temperature_c', noon, 80, [ramp], () => 0.5),
      22.5,
    );
    assert.equal(
      sample(dc, 'temperature_c', noon, 19, [ramp], () => 0.5),
      22.5,
    );
  });

  it('keeps the small jitter of a step', () => {
    // random() = 1 adds +0.1 to the target at the midpoint (26.5).
    assert.equal(
      sample(dc, 'temperature_c', noon, 50, [ramp], () => 1),
      26.6,
    );
  });

  it('only affects its own device and metric', () => {
    assert.equal(
      sample(air, 'co2_ppm', night, 50, [ramp], () => 0.5),
      650,
    );
  });
});

describe('sample with a spike', () => {
  const spike: Anomaly = { ...parseAnomaly('dc-env-01:temperature_c:30.5:20:60'), shape: 'spike' };
  const at = (elapsed: number) => sample(dc, 'temperature_c', noon, elapsed, [spike], () => 0.5);

  it('rises to the value at the midpoint of the window', () => {
    assert.equal(at(20), 22.5);
    assert.equal(at(35), 26.5);
    assert.equal(at(50), 30.5);
  });

  it('falls back towards the baseline, symmetrically', () => {
    assert.equal(at(65), 26.5);
    assert.equal(at(79), 22.8);
  });

  it('is at the baseline outside the window', () => {
    assert.equal(at(80), 22.5);
    assert.equal(at(10), 22.5);
  });

  it('starts from the daily curve of the device, not from a fixed number', () => {
    const co2: Anomaly = {
      deviceId: 'lha-air-01',
      metric: 'co2_ppm',
      value: 1450,
      startAt: 0,
      duration: 10,
      shape: 'spike',
    };
    // At the start of the window a spike is at the baseline, which is the daily curve at that time.
    assert.equal(
      sample(air, 'co2_ppm', night, 0, [co2], () => 0.5),
      650,
    );
    assert.equal(
      sample(air, 'co2_ppm', night, 5, [co2], () => 0.5),
      1450,
    );
  });
});

describe('baselineValue', () => {
  it('is the profile base for a kind without a daily curve', () => {
    assert.equal(baselineValue(dc, 'temperature_c', noon), 22.5);
    assert.equal(baselineValue(dc, 'humidity_pct', night), 45);
  });

  it('follows the daily curve of a kind that has one', () => {
    const expected = 650 + 350 * Math.sin((5 / 12) * Math.PI); // 12:00 on campus
    assert.ok(Math.abs(baselineValue(air, 'co2_ppm', noon) - expected) < 1e-9);
  });

  it('adds nothing from the daily curve at night', () => {
    assert.equal(baselineValue(air, 'co2_ppm', night), 650);
  });

  it('falls back to a flat profile for a kind or metric it does not know', () => {
    const unknown: DeviceSpec = { id: 'x-01', kind: 'weather_station', zoneCode: 'Z', metrics: [] };
    assert.equal(baselineValue(unknown, 'power_kw', noon), 50);
  });
});

describe('metricProfile', () => {
  it('reports the baseline, the noise and no daily swing for a server room', () => {
    assert.deepEqual(metricProfile(dc, 'temperature_c'), {
      baseline: 22.5,
      noise: 0.3,
      dailySwing: 0,
    });
  });

  it('reports the daily swing of a kind that has one', () => {
    assert.deepEqual(metricProfile(air, 'co2_ppm'), { baseline: 650, noise: 40, dailySwing: 350 });
  });

  it('falls back to the flat profile that the generator uses for a metric it does not know', () => {
    const odd: DeviceSpec = { id: 'x', kind: 'unknown_kind', zoneCode: 'Z', metrics: ['co2_ppm'] };
    assert.deepEqual(metricProfile(odd, 'co2_ppm'), { baseline: 50, noise: 1, dailySwing: 0 });
  });

  it('agrees with the values the generator produces: the baseline is the noise-free value at night', () => {
    const { baseline, noise } = metricProfile(dc, 'temperature_c');
    assert.equal(baselineValue(dc, 'temperature_c', night), baseline);
    const value = sample(dc, 'temperature_c', night, 0, [], () => 1);
    assert.ok(Math.abs(value - (baseline + noise)) <= 0.05 + 1e-9);
  });
});

describe('profilesOf', () => {
  it('has an entry for each device with exactly the metrics it reports', () => {
    const profiles = profilesOf([dc, air]);
    assert.deepEqual(Object.keys(profiles), ['dc-env-01', 'lha-air-01']);
    assert.deepEqual(Object.keys(profiles['dc-env-01'] ?? {}), ['temperature_c']);
    assert.equal(profiles['lha-air-01']?.co2_ppm?.dailySwing, 350);
  });

  it('is empty for no devices', () => {
    assert.deepEqual(profilesOf([]), {});
  });
});

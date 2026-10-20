import type { MetricName } from '@itp/telemetry-contract';

export interface DeviceSpec {
  id: string;
  kind: string;
  zoneCode: string;
  metrics: MetricName[];
}

interface Profile {
  base: number;
  noise: number;
  daily?: number;
}

/** Baseline and noise per metric and device kind — plausible values, not physics. */
const PROFILES: Record<string, Partial<Record<MetricName, Profile>>> = {
  server_room: {
    temperature_c: { base: 22.5, noise: 0.3 },
    humidity_pct: { base: 45, noise: 1.5 },
  },
  indoor_air: {
    // CO₂ follows occupancy: highest mid-day.
    co2_ppm: { base: 650, noise: 40, daily: 350 },
    temperature_c: { base: 24, noise: 0.4, daily: 1.5 },
    humidity_pct: { base: 55, noise: 2 },
  },
  power_meter: { power_kw: { base: 120, noise: 8, daily: 35 } },
};

export const ANOMALY_SHAPES = ['step', 'ramp', 'spike'] as const;
export type AnomalyShape = (typeof ANOMALY_SHAPES)[number];

export interface Anomaly {
  deviceId: string;
  metric: MetricName;
  /** Value to hold during the anomaly (`step`), or to reach (`ramp`, `spike`). */
  value: number;
  /** Seconds after start. */
  startAt: number;
  /** Seconds the anomaly lasts. */
  duration: number;
  /**
   * How the value is approached. Absent means `step`: the value is held for the whole window.
   * `ramp` rises linearly from the baseline and approaches `value` by the end of the window (the
   * window is half-open, so it is not reached); `spike` rises to `value` at the midpoint and falls
   * back to the baseline at the end.
   */
  shape?: AnomalyShape;
}

/** Parses `device:metric:value:startAt:duration`, e.g. `dc-env-01:temperature_c:29.5:20:60`. */
export function parseAnomaly(text: string): Anomaly {
  const [deviceId, metric, value, startAt, duration] = text.split(':');
  const numbers = [value, startAt, duration].map(Number);
  if (!deviceId || !metric || numbers.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid anomaly "${text}" — expected device:metric:value:startAt:duration`);
  }
  return {
    deviceId,
    metric: metric as MetricName,
    value: numbers[0]!,
    startAt: numbers[1]!,
    duration: numbers[2]!,
  };
}

function profileOf(device: DeviceSpec, metric: MetricName): Profile {
  return PROFILES[device.kind]?.[metric] ?? { base: 50, noise: 1 };
}

/** What Studio shows of a metric's profile: the baseline, the noise (±) and the daily swing, in the metric's unit. */
export interface MetricProfile {
  baseline: number;
  noise: number;
  dailySwing: number;
}

export function metricProfile(device: DeviceSpec, metric: MetricName): MetricProfile {
  const { base, noise, daily } = profileOf(device, metric);
  return { baseline: base, noise, dailySwing: daily ?? 0 };
}

/** The profile of every metric of every device, by device id: the `profiles` of the state view. */
export function profilesOf(
  devices: DeviceSpec[],
): Record<string, Partial<Record<MetricName, MetricProfile>>> {
  const profiles: Record<string, Partial<Record<MetricName, MetricProfile>>> = {};
  for (const device of devices) {
    const byMetric: Partial<Record<MetricName, MetricProfile>> = {};
    for (const metric of device.metrics) byMetric[metric] = metricProfile(device, metric);
    profiles[device.id] = byMetric;
  }
  return profiles;
}

/** Noise-free value of a metric at a moment in time: what a ramp or a spike starts from. */
export function baselineValue(device: DeviceSpec, metric: MetricName, at: Date): number {
  const profile = profileOf(device, metric);
  const hour = at.getUTCHours() + 7 + at.getUTCMinutes() / 60; // campus is UTC+7
  const daily = profile.daily
    ? profile.daily * Math.max(0, Math.sin(((hour - 7) / 12) * Math.PI))
    : 0;
  return profile.base + daily;
}

/** The value an active anomaly aims at, before jitter. */
function anomalyTarget(
  anomaly: Anomaly,
  device: DeviceSpec,
  metric: MetricName,
  at: Date,
  elapsedS: number,
): number {
  if (!anomaly.shape || anomaly.shape === 'step') return anomaly.value;
  const progress = (elapsedS - anomaly.startAt) / anomaly.duration;
  const weight = anomaly.shape === 'spike' ? 1 - Math.abs(2 * progress - 1) : progress;
  const baseline = baselineValue(device, metric, at);
  return baseline + (anomaly.value - baseline) * weight;
}

/** Value for one metric at a moment in time, with any active anomaly applied. */
export function sample(
  device: DeviceSpec,
  metric: MetricName,
  at: Date,
  elapsedS: number,
  anomalies: Anomaly[],
  random: () => number = Math.random,
): number {
  const active = anomalies.find(
    (a) =>
      a.deviceId === device.id &&
      a.metric === metric &&
      elapsedS >= a.startAt &&
      elapsedS < a.startAt + a.duration,
  );
  if (active) {
    return round(anomalyTarget(active, device, metric, at, elapsedS) + (random() - 0.5) * 0.2);
  }

  const { noise } = profileOf(device, metric);
  return round(baselineValue(device, metric, at) + (random() - 0.5) * 2 * noise);
}

const round = (n: number) => Math.round(n * 10) / 10;

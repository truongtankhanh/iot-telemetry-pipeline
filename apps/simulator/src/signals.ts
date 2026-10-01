import type { MetricName } from '@itp/telemetry-contract';

export interface DeviceSpec {
  id: string;
  kind: string;
  zoneCode: string;
  metrics: MetricName[];
}

/** Baseline and noise per metric and device kind — plausible values, not physics. */
const PROFILES: Record<
  string,
  Partial<Record<MetricName, { base: number; noise: number; daily?: number }>>
> = {
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

export interface Anomaly {
  deviceId: string;
  metric: MetricName;
  /** Value to hold during the anomaly. */
  value: number;
  /** Seconds after start. */
  startAt: number;
  /** Seconds the anomaly lasts. */
  duration: number;
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
  if (active) return round(active.value + (random() - 0.5) * 0.2);

  const profile = PROFILES[device.kind]?.[metric] ?? { base: 50, noise: 1 };
  const hour = at.getUTCHours() + 7 + at.getUTCMinutes() / 60; // campus is UTC+7
  const daily = profile.daily
    ? profile.daily * Math.max(0, Math.sin(((hour - 7) / 12) * Math.PI))
    : 0;
  return round(profile.base + daily + (random() - 0.5) * 2 * profile.noise);
}

const round = (n: number) => Math.round(n * 10) / 10;

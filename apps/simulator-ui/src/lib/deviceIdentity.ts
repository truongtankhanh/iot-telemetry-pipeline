import { METRICS, type MetricName } from '@itp/telemetry-contract';
import type { DeviceInfo } from '../api/types';

/**
 * A device is recognisable without reading its name: a shape and a glyph for its kind, a short code for
 * the device, an icon for each metric (frame 00, "Device identity"). Colour and light are never identity:
 * they are status.
 */
export type DeviceShape = 'rounded-square' | 'circle' | 'hexagon' | 'rounded';
export type DeviceGlyph = 'rack' | 'airflow' | 'bolt' | 'chip';

export interface KindIdentity {
  shape: DeviceShape;
  glyph: DeviceGlyph;
  /** Words for a tooltip and a screen reader. */
  label: string;
}

const KINDS: Record<string, KindIdentity> = {
  server_room: { shape: 'rounded-square', glyph: 'rack', label: 'Server room' },
  indoor_air: { shape: 'circle', glyph: 'airflow', label: 'Indoor air' },
  power_meter: { shape: 'hexagon', glyph: 'bolt', label: 'Power meter' },
};

/** A kind the registry has and Studio does not know yet (a catalogue can add one): a neutral shape, never an error. */
export function kindIdentity(kind: string): KindIdentity {
  const known = Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
  if (known) return known;
  const words = kind.replace(/[_-]+/g, ' ').trim();
  return {
    shape: 'rounded',
    glyph: 'chip',
    label: words === '' ? 'Device' : words.charAt(0).toUpperCase() + words.slice(1),
  };
}

export type MetricIconName = 'temperature' | 'humidity' | 'co2' | 'power' | 'gauge';

const METRIC_ICONS: Record<MetricName, MetricIconName> = {
  temperature_c: 'temperature',
  humidity_pct: 'humidity',
  co2_ppm: 'co2',
  power_kw: 'power',
};

export const metricIcon = (metric: string): MetricIconName =>
  Object.hasOwn(METRIC_ICONS, metric) ? METRIC_ICONS[metric as MetricName] : 'gauge';

const METRIC_LABELS: Record<MetricName, string> = {
  temperature_c: 'Temp',
  humidity_pct: 'Humidity',
  co2_ppm: 'CO₂',
  power_kw: 'Power',
};

/** A short name for a tab or a tag (`Temp`, `CO₂`); the metric's own name for one the contract lacks. */
export const metricLabel = (metric: string): string =>
  Object.hasOwn(METRIC_LABELS, metric) ? METRIC_LABELS[metric as MetricName] : metric;

/** The unit of a metric from the contract (`°C`, `%`, `ppm`, `kW`); empty for a metric the contract lacks. */
export const metricUnit = (metric: string): string =>
  Object.hasOwn(METRICS, metric) ? METRICS[metric as MetricName].unit : '';

/**
 * A short code from the zone code and a position: the zone code without its `BLD-` prefix, and when the
 * zone has more than one device, `·` and the device's place among them in registry order (`DC·1`, `DC·2`;
 * `LIB`, `LHA`, `STU`, `HUB`).
 */
export function deviceCode(device: DeviceInfo, devices: DeviceInfo[]): string {
  const zone = device.zoneCode.replace(/^BLD-/i, '').trim();
  if (zone === '') return device.id.slice(0, 3).toUpperCase();
  const peers = devices.filter((d) => d.zoneCode === device.zoneCode);
  if (peers.length < 2) return zone;
  const index = peers.findIndex((d) => d.id === device.id);
  return `${zone}·${index + 1}`;
}

import type { MetricName } from '@itp/telemetry-contract';
import type { DeviceInfo, EngineSnapshot, RulesView } from '../api/types';
import type { NodeStateName } from './nodeState';
import { formatValue, isBeyond, rulesFor } from './rules';
import { metricUnit } from './deviceIdentity';

/** The states of a device in Fleet. They partition the devices: every device is exactly one of them. */
export type DeviceStatusKind = 'running' | 'anomaly' | 'silent' | 'paused' | 'stopped';

export interface DeviceStatus {
  kind: DeviceStatusKind;
  /** How the badge and the card draw it (frame 00). A stopped device is the operator's choice, so it is dark like a paused one. */
  node: NodeStateName;
  /** The word that goes with the icon: a state is never colour or light alone. */
  word: string;
  /** For paused, stopped and silent: when the device was last heard from; `null` when it never was. */
  since: number | null;
  /** For an anomaly: what is beyond which line, in words. */
  reason: string | null;
}

export const STATUS_WORDS: Record<DeviceStatusKind, string> = {
  running: 'Running',
  anomaly: 'Anomaly',
  silent: 'Silent',
  paused: 'Paused',
  stopped: 'Stopped',
};

/** The tone of the pill that carries a state: a word and an icon go with it, so it is never colour alone. */
export const STATUS_TONES = {
  running: 'ok',
  anomaly: 'warn',
  silent: 'bad',
  paused: 'unknown',
  stopped: 'unknown',
} as const satisfies Record<DeviceStatusKind, 'ok' | 'warn' | 'bad' | 'unknown'>;

/** The order for "problems first": what needs attention, then what is not publishing, then what is well. */
export const STATUS_ORDER: DeviceStatusKind[] = [
  'anomaly',
  'silent',
  'paused',
  'stopped',
  'running',
];

/** A device that should be publishing but has said nothing for this long is silent. */
export const SILENT_AFTER_INTERVALS = 3;
export const SILENT_AFTER_MIN_MS = 5000;

export interface DeviceStatusInput {
  device: DeviceInfo;
  /** The engine's entry for the device; `undefined` if the engine does not know it (then it counts as stopped). */
  engineDevice: EngineSnapshot['devices'][number] | undefined;
  engine: Pick<EngineSnapshot, 'anomalies' | 'elapsedS'>;
  rules: RulesView;
  /** The newest value of each metric, from the history. */
  latest: Partial<Record<MetricName, number>>;
  /** When the device was last heard from (ms since the epoch), or `null`. */
  lastSeen: number | null;
  now: number;
}

/**
 * What state a device is in. The engine knows running, paused and stopped. Of the running ones, silent is one that
 * has said nothing for three intervals (at least five seconds): the engine says running, the broker has heard
 * nothing, and that is the state worth noticing. A device that has never been heard from since the page opened is
 * not called silent (there is no "since" to give, and a reload would flag every device for a moment).
 * An anomaly is a latest value beyond a rule's raise line; with rules not available it is a value inside an
 * anomaly the engine is playing now.
 */
export function deviceStatus(input: DeviceStatusInput): DeviceStatus {
  const { device, engineDevice, engine, rules, latest, lastSeen, now } = input;
  const state = engineDevice?.state ?? 'stopped';

  const base = (
    kind: DeviceStatusKind,
    node: NodeStateName,
    extra: Partial<DeviceStatus> = {},
  ) => ({
    kind,
    node,
    word: STATUS_WORDS[kind],
    since: null,
    reason: null,
    ...extra,
  });

  if (state === 'stopped') return base('stopped', 'paused', { since: lastSeen });
  if (state === 'paused') return base('paused', 'paused', { since: lastSeen });

  const silentAfter = Math.max(
    SILENT_AFTER_INTERVALS * (engineDevice?.intervalMs ?? 0),
    SILENT_AFTER_MIN_MS,
  );
  if (lastSeen !== null && now - lastSeen > silentAfter) {
    return base('silent', 'down', { since: lastSeen });
  }

  const reason = anomalyReason(device, rules, latest) ?? engineAnomaly(device, engine, rules);
  return reason === null ? base('running', 'healthy') : base('anomaly', 'anomaly', { reason });
}

function anomalyReason(
  device: DeviceInfo,
  rules: RulesView,
  latest: Partial<Record<MetricName, number>>,
): string | null {
  for (const metric of device.metrics) {
    const value = latest[metric];
    if (value === undefined) continue;
    const rule = rulesFor(rules, device, metric).find((r) => isBeyond(r, value));
    if (rule) {
      const unit = metricUnit(metric);
      const side = rule.direction === 'above' ? 'above' : 'below';
      return `${metric} ${formatValue(metric, value)}${unit ? ` ${unit}` : ''}, ${side} ${rule.raise}`;
    }
  }
  return null;
}

/** Without rules, the engine's own anomalies are all there is to go by. */
function engineAnomaly(
  device: DeviceInfo,
  engine: Pick<EngineSnapshot, 'anomalies' | 'elapsedS'>,
  rules: RulesView,
): string | null {
  if (rules.available) return null;
  const active = engine.anomalies.find(
    ({ anomaly }) =>
      anomaly.deviceId === device.id &&
      engine.elapsedS >= anomaly.startAt &&
      engine.elapsedS < anomaly.startAt + anomaly.duration,
  );
  return active ? `${active.anomaly.metric} is being driven to ${active.anomaly.value}` : null;
}

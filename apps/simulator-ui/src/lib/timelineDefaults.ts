import type { Anomaly, DeviceInfo, RulesView, StateView } from '../api/types';
import { breachValue } from './labFault';
import { rangeOf, rulesFor } from './rules';
import type { EditorDoc } from './timelineEditor';

/** How long a new anomaly lasts unless something is in the way. */
export const DEFAULT_DURATION_S = 30;

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface DefaultInput {
  doc: EditorDoc;
  devices: readonly DeviceInfo[];
  rules: RulesView;
  profiles: StateView['profiles'];
  /** The selected entry: a new anomaly goes on its device and metric, after it. */
  selectedId: string | null;
  /** A lane the person pointed at (its device and metric) and the second they pointed at on it. */
  at?: { deviceId: string; metric: string; startAt: number };
}

/** The metric to start a device with: one a rule watches, else the first it reports. */
function preferredMetric(
  device: DeviceInfo,
  rules: RulesView,
): DeviceInfo['metrics'][number] | null {
  const watched = device.metrics.find((metric) => rulesFor(rules, device, metric).length > 0);
  return watched ?? device.metrics[0] ?? null;
}

/**
 * The anomaly "Add anomaly" makes: a breach a little beyond the rule's raise line (the Lab's `breachValue`, so it does something
 * when it is left alone), lasting 30 s, on the signal of the selected anomaly or of the lane that was pointed at, after what is
 * already there; without either, on the first device. Pointing at a second on a lane puts it there, as long as the gap holds at
 * least a second. `null` when there is no device to put it on, or the second is inside another anomaly. The caller still
 * adds it through `addEntry`, which has the last word on collisions.
 */
export function defaultAnomaly(input: DefaultInput): Anomaly | null {
  const { doc, devices, rules, profiles } = input;
  const selected = doc.entries.find((entry) => entry.id === input.selectedId)?.anomaly;

  let device: DeviceInfo | undefined;
  let metric: string | null = null;
  if (input.at !== undefined) {
    device = devices.find((candidate) => candidate.id === input.at?.deviceId);
    metric = input.at.metric;
  } else if (selected !== undefined) {
    device = devices.find((candidate) => candidate.id === selected.deviceId);
    metric = selected.metric;
  } else {
    device = devices[0];
    metric = device === undefined ? null : preferredMetric(device, rules);
  }
  if (device === undefined || metric === null) return null;
  const name = metric as Anomaly['metric'];

  const onSignal = doc.entries
    .map((entry) => entry.anomaly)
    .filter((a) => a.deviceId === device.id && a.metric === name);
  let startAt = round1(Math.max(0, ...onSignal.map((a) => a.startAt + a.duration)));
  let duration = DEFAULT_DURATION_S;
  if (input.at !== undefined) {
    startAt = round1(Math.max(0, input.at.startAt));
    if (onSignal.some((a) => a.startAt <= startAt && startAt < a.startAt + a.duration)) return null;
    const next = Math.min(
      Infinity,
      ...onSignal.filter((a) => a.startAt >= startAt).map((a) => a.startAt),
    );
    duration = round1(Math.min(DEFAULT_DURATION_S, next - startAt));
    if (duration < 1) return null;
  }

  const rule = rulesFor(rules, device, name)[0] ?? null;
  const baseline = profiles[device.id]?.[name]?.baseline ?? null;
  const range = rangeOf(name);
  const value =
    breachValue(name, rule, baseline) ?? (range === null ? 0 : round1((range.min + range.max) / 2));
  return { deviceId: device.id, metric: name, value, startAt, duration };
}

import type { Anomaly, DeviceInfo } from '../api/types';
import { metricUnit } from './deviceIdentity';
import { MAX_DURATION_S } from './labFault';
import { rangeOf } from './rules';
import { seconds } from './scenarioExpectation';
import { type EditorDoc, MAX_EDITOR_ANOMALIES } from './timelineEditor';

/**
 * What is wrong with a working copy of a scenario, field by field, in words that name the field, before it is saved or run.
 * The limits are the simulator's (`scenario-document.ts`): the same name pattern, description length, count, duration, and
 * the ranges of the telemetry contract through `rangeOf`, never copied. The simulator stays the authority and says its own
 * reason if it still refuses; this exists so that the person sees the problem next to the field, and so that Save is not
 * offered for a scenario that cannot be saved.
 */

/** The same pattern as the simulator's `SCENARIO_NAME_PATTERN`: it is also the file name, so no dot, slash or capital. */
export const SCENARIO_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Names that a route of `/api/scenarios/` already uses. */
export const RESERVED_NAMES: readonly string[] = ['import'];
export const MAX_DESCRIPTION_LENGTH = 200;

export interface EntryErrors {
  deviceId?: string;
  metric?: string;
  value?: string;
  startAt?: string;
  duration?: string;
  /** The overlap with an earlier anomaly on the same device and metric. */
  overlap?: string;
}

export interface DocErrors {
  name?: string;
  description?: string;
  /** "Add at least one anomaly" or the cap. */
  count?: string;
  /** By entry id; an entry with nothing wrong has none. */
  entries: Record<string, EntryErrors>;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const round1 = (n: number) => Math.round(n * 10) / 10;

/** What is wrong with a name, or `null`. `taken` is the names that exist (for a scenario that is not saved yet). */
export function nameProblem(name: string, taken: readonly string[] = []): string | null {
  if (name === '') return 'Give the scenario a name';
  if (!SCENARIO_NAME_PATTERN.test(name)) {
    return 'Use 1 to 64 characters: lower-case letters, digits and hyphens, starting with a letter or a digit';
  }
  if (RESERVED_NAMES.includes(name)) return `"${name}" is a reserved name`;
  if (taken.includes(name)) return `A scenario named "${name}" already exists`;
  return null;
}

function entryErrors(anomaly: Anomaly, devices: readonly DeviceInfo[]): EntryErrors {
  const errors: EntryErrors = {};
  const device = devices.find((candidate) => candidate.id === anomaly.deviceId);
  if (device === undefined) errors.deviceId = `${anomaly.deviceId} is not in the registry`;
  else if (!device.metrics.includes(anomaly.metric)) {
    errors.metric = `${anomaly.deviceId} does not report ${anomaly.metric}`;
  }

  const range = rangeOf(anomaly.metric);
  if (!finite(anomaly.value)) errors.value = 'Enter a value';
  else if (range !== null && (anomaly.value < range.min || anomaly.value > range.max)) {
    const unit = metricUnit(anomaly.metric);
    errors.value = `Enter a value from ${range.min} to ${range.max}${unit === '' ? '' : ` ${unit}`}`;
  }
  if (!finite(anomaly.startAt) || anomaly.startAt < 0) errors.startAt = 'Start must be 0 s or more';
  if (!finite(anomaly.duration) || anomaly.duration <= 0 || anomaly.duration > MAX_DURATION_S) {
    errors.duration = `Duration must be above 0 s and at most ${MAX_DURATION_S} s`;
  }
  return errors;
}

export interface ValidateInput {
  devices: readonly DeviceInfo[];
  /**
   * The names that exist, when the scenario is not saved yet (a new scenario, a copy): its name may not be one of them.
   * `null` for a saved scenario, whose name is its identity and is not checked against the others.
   */
  taken: readonly string[] | null;
}

/** Every problem of the copy. `isValid(errors)` is true when there is none. */
export function validateDoc(doc: EditorDoc, input: ValidateInput): DocErrors {
  const errors: DocErrors = { entries: {} };

  const name = nameProblem(doc.name, input.taken ?? []);
  if (name !== null) errors.name = name;
  if (doc.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description = `Description is at most ${MAX_DESCRIPTION_LENGTH} characters`;
  }
  if (doc.entries.length === 0) errors.count = 'Add at least one anomaly';
  else if (doc.entries.length > MAX_EDITOR_ANOMALIES) {
    errors.count = `A scenario holds at most ${MAX_EDITOR_ANOMALIES} anomalies`;
  }

  for (const [index, entry] of doc.entries.entries()) {
    const found = entryErrors(entry.anomaly, input.devices);
    const { anomaly } = entry;
    for (const earlier of doc.entries.slice(0, index)) {
      const other = earlier.anomaly;
      const same = other.deviceId === anomaly.deviceId && other.metric === anomaly.metric;
      if (
        same &&
        other.startAt < anomaly.startAt + anomaly.duration &&
        anomaly.startAt < other.startAt + other.duration
      ) {
        found.overlap = `${anomaly.deviceId} already has a fault on ${anomaly.metric} in the scenario from ${seconds(round1(other.startAt))} to ${seconds(round1(other.startAt + other.duration))}`;
        break;
      }
    }
    if (Object.keys(found).length > 0) errors.entries[entry.id] = found;
  }
  return errors;
}

export const isValid = (errors: DocErrors): boolean =>
  errors.name === undefined &&
  errors.description === undefined &&
  errors.count === undefined &&
  Object.keys(errors.entries).length === 0;

/** The first problem as one sentence, for the line next to Save ("Fix 2 problems first"); `null` when there is none. */
export function problemSummary(errors: DocErrors): string | null {
  const own = [errors.name, errors.description, errors.count].filter(
    (text): text is string => text !== undefined,
  );
  const count = own.length + Object.keys(errors.entries).length;
  if (count === 0) return null;
  return count === 1 ? 'Fix 1 problem first' : `Fix ${count} problems first`;
}

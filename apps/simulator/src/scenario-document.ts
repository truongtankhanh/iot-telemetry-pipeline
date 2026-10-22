import { METRIC_NAMES, METRICS, type MetricName } from '@itp/telemetry-contract';
import { ANOMALY_SHAPES, type Anomaly, type AnomalyShape, type DeviceSpec } from './signals.ts';

/**
 * A scenario is a named script of anomalies, written as a plain JSON document so that it can be kept in a
 * file, imported and exported: `{ name, description?, anomalies: [{ deviceId, metric, value, startAt, duration,
 * shape? }] }`. Times are seconds from the start of the scenario.
 */
export interface ScenarioDocument {
  name: string;
  description: string;
  anomalies: Anomaly[];
}

export const SCENARIO_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Names that a route of `/api/scenarios/` already uses. */
export const RESERVED_SCENARIO_NAMES: readonly string[] = ['import'];
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_ANOMALIES = 50;
export const MAX_DURATION_S = 3600;

export type ScenarioParse =
  { ok: true; scenario: ScenarioDocument } | { ok: false; reason: string };

const DOCUMENT_KEYS = ['name', 'description', 'anomalies'];
const ANOMALY_KEYS = ['deviceId', 'metric', 'value', 'startAt', 'duration', 'shape'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const fail = (reason: string): ScenarioParse => ({ ok: false, reason });

/** The first key of `value` that the format does not have: a typo must be refused, not dropped. */
function unknownKey(value: Record<string, unknown>, known: string[]): string | undefined {
  return Object.keys(value).find((key) => !known.includes(key));
}

function rangeText(metric: MetricName): string {
  const { min, max, unit } = METRICS[metric];
  return `${min} to ${max} ${unit}`;
}

/** Checks one anomaly of the document; the reason names its index and the field. */
function parseAnomalyAt(
  raw: unknown,
  index: number,
  devices: readonly DeviceSpec[],
): { ok: true; anomaly: Anomaly } | { ok: false; reason: string } {
  const where = `anomalies[${index}]`;
  if (!isRecord(raw)) return { ok: false, reason: `${where} must be an object` };
  const extra = unknownKey(raw, ANOMALY_KEYS);
  if (extra !== undefined) return { ok: false, reason: `${where}.${extra} is not a known field` };

  const { deviceId, metric, value, startAt, duration, shape } = raw;
  if (typeof deviceId !== 'string' || deviceId === '') {
    return { ok: false, reason: `${where}.deviceId must be a non-empty string` };
  }
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return { ok: false, reason: `${where}: unknown device "${deviceId}"` };

  if (typeof metric !== 'string' || !METRIC_NAMES.includes(metric as MetricName)) {
    return {
      ok: false,
      reason: `${where}.metric must be one of ${METRIC_NAMES.join(', ')}, got ${JSON.stringify(metric)}`,
    };
  }
  const name = metric as MetricName;
  if (!device.metrics.includes(name)) {
    return { ok: false, reason: `${where}: device "${deviceId}" does not report ${name}` };
  }

  if (!isNumber(value)) return { ok: false, reason: `${where}.value must be a finite number` };
  const { min, max } = METRICS[name];
  if (value < min || value > max) {
    return {
      ok: false,
      reason: `${where}.value ${value} is outside the range of ${name} (${rangeText(name)})`,
    };
  }
  if (!isNumber(startAt) || startAt < 0) {
    return { ok: false, reason: `${where}.startAt must be a number of seconds, 0 or more` };
  }
  if (!isNumber(duration) || duration <= 0 || duration > MAX_DURATION_S) {
    return {
      ok: false,
      reason: `${where}.duration must be a number of seconds above 0 and at most ${MAX_DURATION_S}`,
    };
  }
  if (shape !== undefined && !ANOMALY_SHAPES.includes(shape as AnomalyShape)) {
    return {
      ok: false,
      reason: `${where}.shape must be one of ${ANOMALY_SHAPES.join(', ')}, got ${JSON.stringify(shape)}`,
    };
  }

  const anomaly: Anomaly = { deviceId, metric: name, value, startAt, duration };
  if (shape !== undefined) anomaly.shape = shape as AnomalyShape;
  return { ok: true, anomaly };
}

/** The first pair of anomalies that play at once on one device and metric, as a reason. */
function overlap(anomalies: Anomaly[]): string | undefined {
  for (const [j, later] of anomalies.entries()) {
    for (const [i, earlier] of anomalies.slice(0, j).entries()) {
      const sameSignal = earlier.deviceId === later.deviceId && earlier.metric === later.metric;
      const together =
        earlier.startAt < later.startAt + later.duration &&
        later.startAt < earlier.startAt + earlier.duration;
      // The engine plays the first match and does not add two values, so an overlap has no meaning.
      if (sameSignal && together) {
        return `anomalies[${j}] overlaps anomalies[${i}] on ${later.deviceId} ${later.metric}`;
      }
    }
  }
  return undefined;
}

export type AnomaliesParse = { ok: true; anomalies: Anomaly[] } | { ok: false; reason: string };

/**
 * Validates a list of anomalies on its own: 1 to `max` of them, each checked against the registry and the ranges of
 * the telemetry contract, and none overlapping another on one device and metric. A scenario file holds at most
 * `MAX_ANOMALIES`; the cap is a parameter because the Lab's preview takes more (a fault on every device of a large
 * registry). Never throws; the reason names the item and the field.
 */
export function parseAnomalies(
  input: unknown,
  options: { devices: readonly DeviceSpec[]; max: number },
): AnomaliesParse {
  if (!Array.isArray(input) || input.length < 1 || input.length > options.max) {
    return { ok: false, reason: `anomalies must be a list of 1 to ${options.max} anomalies` };
  }

  const parsed: Anomaly[] = [];
  for (const [index, raw] of input.entries()) {
    const result = parseAnomalyAt(raw, index, options.devices);
    if (!result.ok) return result;
    parsed.push(result.anomaly);
  }
  const clash = overlap(parsed);
  if (clash !== undefined) return { ok: false, reason: clash };

  return { ok: true, anomalies: parsed };
}

/**
 * Validates a scenario document against the limits of the format, the registry (`devices`) and the ranges of
 * the telemetry contract. Never throws: the answer is the scenario, or the reason for the first check that
 * failed, in words that name the field.
 */
export function parseScenarioDocument(
  input: unknown,
  options: { devices: readonly DeviceSpec[] },
): ScenarioParse {
  if (!isRecord(input)) return fail('A scenario must be a JSON object');
  const extra = unknownKey(input, DOCUMENT_KEYS);
  if (extra !== undefined) return fail(`"${extra}" is not a known field of a scenario`);

  const { name, description = '', anomalies } = input;
  if (typeof name !== 'string' || !SCENARIO_NAME_PATTERN.test(name)) {
    return fail(
      'name must be 1 to 64 characters: lower-case letters, digits and hyphens, starting with a letter or digit',
    );
  }
  if (RESERVED_SCENARIO_NAMES.includes(name)) return fail(`"${name}" is a reserved name`);
  if (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH) {
    return fail(`description must be text of at most ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  const list = parseAnomalies(anomalies, { devices: options.devices, max: MAX_ANOMALIES });
  if (!list.ok) return fail(list.reason);

  return { ok: true, scenario: { name, description, anomalies: list.anomalies } };
}

/** Seconds from the start of the scenario to the end of its last anomaly. */
export function lengthS(scenario: ScenarioDocument): number {
  return Math.max(...scenario.anomalies.map((a) => a.startAt + a.duration));
}

/** A copy of the anomalies, which the engine takes and the caller may shift without changing the scenario. */
export function toAnomalies(scenario: ScenarioDocument): Anomaly[] {
  return scenario.anomalies.map((anomaly) => ({ ...anomaly }));
}

/**
 * The `--anomaly` flag (`device:metric:value:startAt:duration[:shape]`) for an anomaly. A step, with or without a
 * `shape`, is written with five fields (the flag's default); `ramp` and `spike` add the sixth, so every valid
 * scenario document can be played from the command line.
 */
export function toAnomalyFlag(anomaly: Anomaly): string {
  const { deviceId, metric, value, startAt, duration, shape } = anomaly;
  const flag = `${deviceId}:${metric}:${value}:${startAt}:${duration}`;
  return shape === undefined || shape === 'step' ? flag : `${flag}:${shape}`;
}

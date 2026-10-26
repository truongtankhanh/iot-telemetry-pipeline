import { METRIC_NAMES } from '@itp/telemetry-contract';
import {
  type BenchOutcome,
  type BenchProgress,
  type BenchResult,
  MAX_MESSAGES,
} from './bench-run.ts';
import type { DeviceSpec } from './signals.ts';

/**
 * What the control server and its benchmark process say to each other over the IPC channel of `fork`.
 * Nothing here is trusted because of where it came from: both ends read what arrives with the guards below,
 * and a message that does not fit is dropped, not guessed at.
 */

/** Parent to child: the settings of the run. The database URL travels here, not on the command line. */
export interface StartMessage {
  type: 'start';
  broker: string;
  database: string;
  devices: DeviceSpec[];
  messages: number;
  timeoutS: number;
  /** The run's number in this session; it decides the offset of the timestamps (`sessionTsBase`). */
  run: number;
}

export interface StopMessage {
  type: 'stop';
}

export type ParentMessage = StartMessage | StopMessage;

export type ChildMessage =
  | { type: 'progress'; progress: BenchProgress }
  | { type: 'done'; outcome: BenchOutcome; result: BenchResult }
  | { type: 'error'; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function parseDevices(value: unknown): DeviceSpec[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const known: readonly string[] = METRIC_NAMES;
  const devices: DeviceSpec[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    const { id, kind, zoneCode, metrics } = item;
    if (!isString(id) || !isString(kind) || !isString(zoneCode)) return undefined;
    if (!Array.isArray(metrics) || !metrics.every((m) => isString(m) && known.includes(m))) {
      return undefined;
    }
    devices.push({ id, kind, zoneCode, metrics: metrics as DeviceSpec['metrics'] });
  }
  return devices;
}

export function parseParentMessage(value: unknown): ParentMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'stop') return { type: 'stop' };
  if (value.type !== 'start') return undefined;
  const { broker, database, messages, timeoutS, run } = value;
  const devices = parseDevices(value.devices);
  if (!isString(broker) || !isString(database) || devices === undefined) return undefined;
  if (
    !Number.isInteger(messages) ||
    (messages as number) < 1 ||
    (messages as number) > MAX_MESSAGES
  ) {
    return undefined;
  }
  if (!isFiniteNumber(timeoutS) || timeoutS <= 0) return undefined;
  if (!Number.isInteger(run) || (run as number) < 1) return undefined;
  return {
    type: 'start',
    broker,
    database,
    devices,
    messages: messages as number,
    timeoutS,
    run: run as number,
  };
}

const OUTCOMES: readonly unknown[] = ['completed', 'incomplete', 'stopped'];

function parseProgress(value: unknown): BenchProgress | undefined {
  if (!isRecord(value)) return undefined;
  const { phase, published, stored, elapsedMs } = value;
  if (phase !== 'publishing' && phase !== 'waiting') return undefined;
  if (!isFiniteNumber(published) || !isFiniteNumber(elapsedMs)) return undefined;
  if (stored !== null && !isFiniteNumber(stored)) return undefined;
  return { phase, published, stored, elapsedMs };
}

function parseResult(value: unknown): BenchResult | undefined {
  if (!isRecord(value)) return undefined;
  const numbers = [
    'messages',
    'readingsExpected',
    'readingsStored',
    'publishSeconds',
    'endToEndSeconds',
    'messagesPerSecond',
    'readingsPerSecond',
    'vcpu',
  ] as const;
  if (!numbers.every((key) => isFiniteNumber(value[key])) || !isString(value.node))
    return undefined;
  return {
    messages: value.messages as number,
    readingsExpected: value.readingsExpected as number,
    readingsStored: value.readingsStored as number,
    publishSeconds: value.publishSeconds as number,
    endToEndSeconds: value.endToEndSeconds as number,
    messagesPerSecond: value.messagesPerSecond as number,
    readingsPerSecond: value.readingsPerSecond as number,
    vcpu: value.vcpu as number,
    node: value.node,
  };
}

export function parseChildMessage(value: unknown): ChildMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'progress') {
    const progress = parseProgress(value.progress);
    return progress ? { type: 'progress', progress } : undefined;
  }
  if (value.type === 'done') {
    const result = parseResult(value.result);
    if (!result || !OUTCOMES.includes(value.outcome)) return undefined;
    return { type: 'done', outcome: value.outcome as BenchOutcome, result };
  }
  if (value.type === 'error') {
    return isString(value.message) ? { type: 'error', message: value.message } : undefined;
  }
  return undefined;
}

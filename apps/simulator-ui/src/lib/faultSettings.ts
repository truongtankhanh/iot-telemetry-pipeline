import type {
  DeviceInfo,
  FaultBodies,
  FaultKind,
  FaultScope,
  FaultsSnapshot,
  MalformedKind,
} from '../api/types';
import { resolveTargets, type TargetScope } from './labTargets';

/**
 * What the Faults page (frame 07) knows about the faults it sets: the limits, the words, the defaults, the drafts of the
 * values being edited and the checks on them. Pure, so the page and its tests share one set of rules.
 *
 * The limits are a copy of the simulator's (`FAULT_LIMITS` and `MALFORMED_KINDS` in `apps/simulator/src/faults.ts`), which
 * Studio cannot import (ADR-0011: the simulator's types pull Node typings into browser code). The simulator is the one that
 * enforces them and refuses with the field named, so a copy that went stale would show a hint that is wrong, not accept
 * a value that is; `faultSettings.test.ts` pins every number so that changing one side is noticed.
 */

export const FAULT_LIMITS = {
  /** A percentage is above 0 and at most this. */
  maxPercent: 100,
  minDelayMs: 1,
  maxDelayMs: 10_000,
  minWindow: 2,
  maxWindow: 10,
  /** What the "Send 1,000" button sends, and the most the simulator takes in one burst. */
  burst: 1000,
  maxBurst: 5000,
  minLinkLossS: 1,
  maxLinkLossS: 3600,
} as const;

/** The slider of a percentage runs 0 to this; the number beside it takes up to `maxPercent`. */
export const PERCENT_TRACK_MAX = 20;

/**
 * The ten kinds of malformed payload, in the order of frame 07 with `empty` (a reason of the parser the frame left out) after
 * `ts`. Each is rejected by ingest with a reason of the same name (`telemetry_rejections_total{reason}`); `topic` is the one
 * of the topic parser.
 */
export const MALFORMED_KINDS: readonly MalformedKind[] = [
  'range',
  'json',
  'shape',
  'seq',
  'ts',
  'empty',
  'metric',
  'value',
  'size',
  'topic',
];

/** What each kind does to a message, for the tooltip of its chip. */
export const MALFORMED_HINTS: Record<MalformedKind, string> = {
  range: 'A value outside the range of its metric',
  json: 'A body that is not valid JSON',
  shape: 'JSON that is not an object',
  seq: 'A seq that is negative or not a whole number',
  ts: 'A timestamp without a time zone',
  empty: 'A message with no metrics',
  metric: 'A metric the contract does not define',
  value: 'A value that is not a number',
  size: 'A body over 4096 bytes',
  topic: 'A topic that is not campus/<zone>/<device>/telemetry',
};

/** The rows of the page, in the frame's order, link loss last. A burst is a one-shot, so it is a row but not a switch. */
export type FaultRowKind = FaultKind | 'burst';

export interface FaultRowInfo {
  kind: FaultRowKind;
  title: string;
  description: string;
}

export const FAULT_ROWS: readonly FaultRowInfo[] = [
  {
    kind: 'drop',
    title: 'Drop messages',
    description: 'The device counts the message but never sends it, so seq skips.',
  },
  {
    kind: 'duplicate',
    title: 'Duplicate messages',
    description: 'The same payload is sent twice. Ingest stores the reading once.',
  },
  {
    kind: 'malformed',
    title: 'Malformed payloads',
    description:
      'A share of messages break the contract. Pick how; ingest rejects them and counts the reason.',
  },
  {
    kind: 'delay',
    title: 'Delay and jitter',
    description:
      'Hold each message back before publishing, so ingest lag and the timestamp age grow.',
  },
  {
    kind: 'reorder',
    title: 'Out-of-order delivery',
    description: 'Hold a few messages of a device and send them in a different order.',
  },
  {
    kind: 'burst',
    title: 'Burst',
    description:
      'Publish a batch as fast as the broker accepts it. Not a benchmark: use Analytics for numbers.',
  },
  {
    kind: 'link-loss',
    title: 'Link loss',
    description:
      "Close the simulator's connection to the broker. What it builds meanwhile is lost, so seq skips.",
  },
];

// ---- The drafts: the values in the controls ----

/** A number is `null` while its field is empty. */
export interface PercentDraft {
  percent: number | null;
}
export interface MalformedDraft {
  percent: number | null;
  kinds: MalformedKind[];
}
export interface DelayDraft {
  delayMs: number | null;
  jitterMs: number | null;
}
export interface ReorderDraft {
  window: number | null;
}
export interface LinkLossDraft {
  forS: number | null;
}

export interface FaultDrafts {
  drop: PercentDraft;
  duplicate: PercentDraft;
  malformed: MalformedDraft;
  delay: DelayDraft;
  reorder: ReorderDraft;
  'link-loss': LinkLossDraft;
}

/** What a fault is set to the first time it is switched on (the values of the frame). */
export const DEFAULT_DRAFTS: FaultDrafts = {
  drop: { percent: 5 },
  duplicate: { percent: 2 },
  malformed: { percent: 3, kinds: ['range'] },
  delay: { delayMs: 500, jitterMs: 100 },
  reorder: { window: 4 },
  'link-loss': { forS: null },
};

/**
 * The drafts for an engine: where a fault is on, its settings (the engine is the truth); where it is off, what the person
 * last had in the control, or the defaults. `previous` is the page's drafts before the engine changed.
 */
export function draftsFrom(faults: FaultsSnapshot, previous?: FaultDrafts): FaultDrafts {
  const base = previous ?? DEFAULT_DRAFTS;
  return {
    drop: faults.drop ? { percent: faults.drop.percent } : base.drop,
    duplicate: faults.duplicate ? { percent: faults.duplicate.percent } : base.duplicate,
    malformed: faults.malformed
      ? { percent: faults.malformed.percent, kinds: [...faults.malformed.kinds] }
      : { ...base.malformed, kinds: [...base.malformed.kinds] },
    delay: faults.delay
      ? { delayMs: faults.delay.delayMs, jitterMs: faults.delay.jitterMs }
      : base.delay,
    reorder: faults.reorder ? { window: faults.reorder.window } : base.reorder,
    'link-loss': faults.linkLoss ? { forS: faults.linkLoss.forS } : base['link-loss'],
  };
}

/** Whether the engine has this fault on (link loss: whether the link is down). */
export function isFaultOn(kind: FaultKind, faults: FaultsSnapshot): boolean {
  return kind === 'link-loss' ? faults.linkLoss !== null : faults[kind] !== null;
}

/** The sentence under a control that holds a value the simulator would refuse, by field. Empty when the draft is fine. */
export type FieldErrors = Partial<Record<string, string>>;

export const hasErrors = (errors: FieldErrors): boolean =>
  Object.values(errors).some((message) => message !== undefined);

const thousands = (n: number) => n.toLocaleString('en-US');

const isNumber = (value: number | null): value is number =>
  value !== null && Number.isFinite(value);

function percentError(percent: number | null): string | undefined {
  if (!isNumber(percent)) return 'Enter a percentage';
  if (percent <= 0 || percent > FAULT_LIMITS.maxPercent) {
    return `A percentage is above 0 and at most ${FAULT_LIMITS.maxPercent}`;
  }
  return undefined;
}

/** Checks the draft of one fault with the simulator's limits; the keys are the fields of the draft. */
export function checkDraft<K extends FaultKind>(kind: K, draft: FaultDrafts[K]): FieldErrors {
  switch (kind) {
    case 'drop':
    case 'duplicate': {
      const error = percentError((draft as PercentDraft).percent);
      return error === undefined ? {} : { percent: error };
    }
    case 'malformed': {
      const { percent, kinds } = draft as MalformedDraft;
      const errors: FieldErrors = {};
      const error = percentError(percent);
      if (error !== undefined) errors.percent = error;
      if (kinds.length === 0) errors.kinds = 'Choose at least one kind';
      return errors;
    }
    case 'delay': {
      const { delayMs, jitterMs } = draft as DelayDraft;
      const errors: FieldErrors = {};
      if (
        !isNumber(delayMs) ||
        delayMs < FAULT_LIMITS.minDelayMs ||
        delayMs > FAULT_LIMITS.maxDelayMs
      ) {
        errors.delayMs = `The delay is from ${FAULT_LIMITS.minDelayMs} to ${thousands(FAULT_LIMITS.maxDelayMs)} ms`;
      }
      if (!isNumber(jitterMs) || jitterMs < 0 || (isNumber(delayMs) && jitterMs > delayMs)) {
        errors.jitterMs = 'The jitter is from 0 to the delay';
      }
      return errors;
    }
    case 'reorder': {
      const { window } = draft as ReorderDraft;
      if (
        !isNumber(window) ||
        !Number.isInteger(window) ||
        window < FAULT_LIMITS.minWindow ||
        window > FAULT_LIMITS.maxWindow
      ) {
        return {
          window: `The window is a whole number from ${FAULT_LIMITS.minWindow} to ${FAULT_LIMITS.maxWindow}`,
        };
      }
      return {};
    }
    case 'link-loss': {
      const { forS } = draft as LinkLossDraft;
      if (forS === null) return {};
      if (
        !Number.isFinite(forS) ||
        forS < FAULT_LIMITS.minLinkLossS ||
        forS > FAULT_LIMITS.maxLinkLossS
      ) {
        return {
          forS: `Restore after is from ${FAULT_LIMITS.minLinkLossS} to ${thousands(FAULT_LIMITS.maxLinkLossS)} seconds, or empty`,
        };
      }
      return {};
    }
    default:
      return {};
  }
}

/** The body of `PUT /api/faults/:kind` for a draft that passed `checkDraft`. */
export function bodyOf<K extends FaultKind>(kind: K, draft: FaultDrafts[K]): FaultBodies[K] {
  switch (kind) {
    case 'drop':
    case 'duplicate':
      return { percent: (draft as PercentDraft).percent ?? 0 } as FaultBodies[K];
    case 'malformed': {
      const { percent, kinds } = draft as MalformedDraft;
      return { percent: percent ?? 0, kinds: [...kinds] } as FaultBodies[K];
    }
    case 'delay': {
      const { delayMs, jitterMs } = draft as DelayDraft;
      return { delayMs: delayMs ?? 0, jitterMs: jitterMs ?? 0 } as FaultBodies[K];
    }
    case 'reorder':
      return { window: (draft as ReorderDraft).window ?? 0 } as FaultBodies[K];
    default: {
      const { forS } = draft as LinkLossDraft;
      return (forS === null ? {} : { forS }) as FaultBodies[K];
    }
  }
}

/**
 * Whether the engine already has this fault set to this body, so that a commit that changes nothing (a release of the slider
 * where it was, a blur after Enter) is not sent. A fault that is off is never current; link loss compares the restore time.
 */
export function isCurrent<K extends FaultKind>(
  kind: K,
  body: FaultBodies[K],
  faults: FaultsSnapshot,
): boolean {
  switch (kind) {
    case 'drop':
    case 'duplicate': {
      const on = kind === 'drop' ? faults.drop : faults.duplicate;
      return on !== null && on.percent === (body as FaultBodies['drop']).percent;
    }
    case 'malformed': {
      const { percent, kinds } = body as FaultBodies['malformed'];
      const on = faults.malformed;
      return (
        on !== null &&
        on.percent === percent &&
        on.kinds.length === kinds.length &&
        on.kinds.every((k, i) => k === kinds[i])
      );
    }
    case 'delay': {
      const { delayMs, jitterMs } = body as FaultBodies['delay'];
      return (
        faults.delay !== null &&
        faults.delay.delayMs === delayMs &&
        faults.delay.jitterMs === jitterMs
      );
    }
    case 'reorder':
      return (
        faults.reorder !== null && faults.reorder.window === (body as FaultBodies['reorder']).window
      );
    default:
      return (
        faults.linkLoss !== null &&
        faults.linkLoss.forS === ((body as FaultBodies['link-loss']).forS ?? null)
      );
  }
}

// ---- Words ----

/** 5 → "5", 0.5 → "0.5", 2.25 → "2.25". */
export const percentText = (percent: number): string => String(Math.round(percent * 100) / 100);

/** One line on what a fault that is on does now, from the engine's own settings. `null` for a fault that is off. */
export function faultSentence(kind: FaultKind, faults: FaultsSnapshot): string | null {
  switch (kind) {
    case 'drop':
      return faults.drop === null
        ? null
        : `${percentText(faults.drop.percent)} % of messages are not sent`;
    case 'duplicate':
      return faults.duplicate === null
        ? null
        : `${percentText(faults.duplicate.percent)} % of messages are sent twice`;
    case 'malformed':
      return faults.malformed === null
        ? null
        : `${percentText(faults.malformed.percent)} % of messages are replaced by a malformed one (${faults.malformed.kinds.join(', ')})`;
    case 'delay':
      return faults.delay === null
        ? null
        : `Each message waits ${thousands(faults.delay.delayMs)} ms, give or take ${thousands(faults.delay.jitterMs)} ms`;
    case 'reorder':
      return faults.reorder === null
        ? null
        : `${faults.reorder.window} messages of a device are held and sent in a different order`;
    case 'link-loss':
      return faults.linkLoss === null
        ? null
        : faults.linkLoss.forS === null
          ? 'The link is down until it is restored'
          : `The link is down and restores itself after ${thousands(faults.linkLoss.forS)} s`;
    default:
      return null;
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The banner: "3 faults are active on 4 devices". */
export function activeSentence(
  faults: Pick<FaultsSnapshot, 'activeCount' | 'deviceCount'>,
): string {
  const { activeCount, deviceCount } = faults;
  return `${plural(activeCount, 'fault is', 'faults are')} active on ${plural(deviceCount, 'device', 'devices')}`;
}

// ---- The scope ----

/** The device ids the picker shows as chosen: those of a selection, none for "All running". */
export function chosenDevices(scope: FaultScope): string[] {
  return scope.mode === 'selected' ? [...scope.deviceIds] : [];
}

/**
 * The device ids the engine's scope will hold for a choice in the picker. A zone or a class is expanded once, here, to
 * the devices that have it: the engine scope is a list of devices, not a rule.
 */
export function deviceIdsOf(
  devices: readonly DeviceInfo[],
  scope: TargetScope,
  targets: readonly string[],
): string[] {
  return resolveTargets(devices, scope, targets).map((device) => device.id);
}

/** What the scope row says under its controls. */
export function scopeSentence(faults: FaultsSnapshot): string {
  const { scope, deviceCount } = faults;
  if (scope.mode === 'running') {
    return `Every device that is running when a message is built; ${plural(deviceCount, 'device is', 'devices are')} now. A device started later is included.`;
  }
  return `${plural(scope.deviceIds.length, 'device', 'devices')} chosen. Link loss is the simulator's own connection and has no scope.`;
}

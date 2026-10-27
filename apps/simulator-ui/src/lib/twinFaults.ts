import type { BrokerState, FaultsSnapshot, IngestState } from '../api/types';
import { formatClockTime } from './time';

/**
 * What the twin draws of the faults and of the pipeline, worked out from the engine's own state (`faults` of the state
 * view) and never on a loop of its own: switch a fault off and the next state view has no visual for it
 * (`docs/design/simulator/digital-twin.md`, "What each fault looks like"). Nothing here imports three.js or React.
 */

export type HubState = 'ok' | 'warn' | 'down' | 'no-link' | 'unknown';

/**
 * How the hub (the logical Pipeline object) stands. `word` is the word `derivePipeline` gives the same stage on Topology
 * (`Connected`, `Disconnected`, `Unreachable`, `Not ready`, `Checking`), so the two pages never say two things; a test
 * pins it. `no-link` is the **fault** (the simulator's link to the broker is cut on purpose); `unknown` with a lost Studio
 * link is something else, and the two are never mixed.
 */
export interface HubStatus {
  state: HubState;
  /** What the word is about: `Broker`, `Ingest`, `Link`, `Studio`. */
  subject: string;
  word: string;
  detail: string | null;
}

export interface HubInput {
  faults: FaultsSnapshot;
  broker: BrokerState;
  ingest: IngestState;
  /** The link between **Studio and the simulator** is lost: nothing the twin shows is current. */
  linkLost: boolean;
}

export function hubStatus({ faults, broker, ingest, linkLost }: HubInput): HubStatus {
  if (linkLost) {
    return {
      state: 'unknown',
      subject: 'Studio',
      word: 'Not updating',
      detail: 'Studio lost its link to the simulator; what is shown is the last it sent',
    };
  }
  if (faults.linkLoss !== null) {
    const since = Date.parse(faults.linkLoss.since);
    const restore =
      faults.linkLoss.forS === null ? '' : `, restores after ${faults.linkLoss.forS} s`;
    return {
      state: 'no-link',
      subject: 'Link',
      word: 'No link',
      detail: `cut by the Link loss fault${Number.isNaN(since) ? '' : ` at ${formatClockTime(since)}`}${restore}`,
    };
  }
  if (!broker.connected) {
    return { state: 'down', subject: 'Broker', word: 'Disconnected', detail: broker.url };
  }
  switch (ingest.status) {
    case 'unreachable':
      return { state: 'down', subject: 'Ingest', word: 'Unreachable', detail: null };
    case 'not-ready':
      return { state: 'warn', subject: 'Ingest', word: 'Not ready', detail: null };
    case 'unknown':
      return { state: 'unknown', subject: 'Ingest', word: 'Checking', detail: null };
    case 'ready':
      return { state: 'ok', subject: 'Ingest', word: 'Ready', detail: null };
  }
}

/** What the faults do to one device's arc (drop and delay; the others are the hub's or the messages'). */
export interface DeviceFault {
  /** Drop: the arc is drawn with gaps. */
  gaps: boolean;
  /** Delay: how many milliseconds a dot is slower (`0` for none). */
  slow: number;
}

// Duplicate has no field here: the copy of a duplicated message is a `published` event of its own (it carries
// `fault: 'duplicate'` on the pulse bus), so the pair of dots comes from the engine's messages, not from a flag.
export const NO_FAULT: DeviceFault = { gaps: false, slow: 0 };

export type ChipTone = 'info' | 'warn' | 'bad';

/** A chip on the hub's label; the text twin says the same words. */
export interface HubChip {
  id: 'dropped' | 'lag' | 'readings' | 'rejected' | 'burst' | 'no-link';
  text: string;
  tone: ChipTone;
}

export interface FaultVisuals {
  byDevice: ReadonlyMap<string, DeviceFault>;
  chips: HubChip[];
  /** A small cross at the hub while a malformed fault is on, with the reasons it can reject for. */
  cross: { reasons: string[] } | null;
  /** The cut link of the Link loss fault: every arc is red and dashed, no dot starts. */
  linkLoss: boolean;
  /** One sentence for each fault that is on, for the text twin. */
  lines: string[];
}

export interface FaultStats {
  /** Readings ingest has stored (`telemetry_readings_total{result="stored"}`), or `null` when not read. */
  storedReadings: number | null;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const grouped = (n: number): string => n.toLocaleString('en-US');

/**
 * The visual of every fault that is on. `scope` limits drop, delay, duplicate, malformed and a burst to the devices it
 * names; a cut link is the connection's and reaches every device. Silent is not a fault flag: a silent device is a
 * device **state**, already the pin's own stale look, so it has no row here. `reorder` has no picture (it is not in the
 * research page's table): it is a line of the text twin, and what it holds back is counted with Delay.
 */
export function faultVisuals(
  faults: FaultsSnapshot,
  devices: readonly { id: string }[],
  stats: FaultStats,
): FaultVisuals {
  const inScope = (id: string): boolean =>
    faults.scope.mode === 'running' || faults.scope.deviceIds.includes(id);

  const byDevice = new Map<string, DeviceFault>();
  for (const { id } of devices) {
    if (!inScope(id)) continue;
    const fault: DeviceFault = {
      gaps: faults.drop !== null,
      slow: faults.delay?.delayMs ?? 0,
    };
    if (fault.gaps || fault.slow > 0) byDevice.set(id, fault);
  }

  const chips: HubChip[] = [];
  if (faults.drop !== null || faults.linkLoss !== null) {
    chips.push({ id: 'dropped', text: `dropped ${grouped(faults.dropped)}`, tone: 'warn' });
  }
  if (faults.delay !== null) {
    const jitter = faults.delay.jitterMs > 0 ? ` ± ${faults.delay.jitterMs}` : '';
    const held = faults.held > 0 ? ` · ${faults.held} held` : '';
    chips.push({ id: 'lag', text: `lag ${faults.delay.delayMs}${jitter} ms${held}`, tone: 'warn' });
  }
  if (faults.duplicate !== null) {
    // The figure that does not move: a duplicate is the same reading arriving again, and ingest stores it once.
    const stored = stats.storedReadings === null ? '—' : grouped(stats.storedReadings);
    chips.push({ id: 'readings', text: `readings ${stored}`, tone: 'info' });
  }
  if (faults.malformed !== null) {
    const kinds = faults.malformed.kinds;
    chips.push({
      id: 'rejected',
      text: kinds.length === 0 ? 'rejected' : `rejected: ${kinds.join(', ')}`,
      tone: 'bad',
    });
  }
  if (faults.bursting) chips.push({ id: 'burst', text: 'burst', tone: 'info' });
  if (faults.linkLoss !== null) chips.push({ id: 'no-link', text: 'no link', tone: 'bad' });

  const where =
    faults.scope.mode === 'running'
      ? 'on the running devices'
      : `on ${count(faults.scope.deviceIds.length, 'selected device')}`;
  const lines: string[] = [];
  if (faults.drop !== null) lines.push(`Drop: ${faults.drop.percent} % of messages ${where}`);
  if (faults.delay !== null) {
    lines.push(
      `Delay: ${faults.delay.delayMs} ms${faults.delay.jitterMs > 0 ? `, jitter ${faults.delay.jitterMs} ms` : ''} ${where}; ${count(faults.held, 'message')} held`,
    );
  }
  if (faults.duplicate !== null) {
    lines.push(`Duplicate: ${faults.duplicate.percent} % of messages ${where}`);
  }
  if (faults.reorder !== null) {
    lines.push(`Reorder: a window of ${faults.reorder.window} messages ${where} (not drawn)`);
  }
  if (faults.malformed !== null) {
    const kinds =
      faults.malformed.kinds.length === 0 ? '' : ` (${faults.malformed.kinds.join(', ')})`;
    lines.push(`Malformed: ${faults.malformed.percent} % of messages ${where}${kinds}`);
  }
  if (faults.bursting) lines.push('Burst: a burst of messages is being sent');
  if (faults.linkLoss !== null) {
    lines.push(
      `Link loss: the simulator's link to the broker is cut${faults.linkLoss.forS === null ? '' : `, for ${faults.linkLoss.forS} s`}`,
    );
  }

  return {
    byDevice,
    chips,
    cross: faults.malformed === null ? null : { reasons: [...faults.malformed.kinds] },
    linkLoss: faults.linkLoss !== null,
    lines,
  };
}

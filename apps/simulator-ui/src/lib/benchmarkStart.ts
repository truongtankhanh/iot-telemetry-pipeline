import { formatCount } from './benchmarkRows';

/** The size `docs/benchmarks.md` and the command line start from. */
export const DEFAULT_MESSAGES = 100_000;

/** The start size the page offers: the default, or the most the simulator accepts when that is less. */
export const defaultMessages = (maxMessages: number): number =>
  Math.min(DEFAULT_MESSAGES, maxMessages);

export type MessagesCheck = { ok: true; messages: number } | { ok: false; reason: string };

/**
 * The size of a run as the simulator accepts it: a whole number from 1 to `maxMessages`. The simulator checks again and names the
 * field when it refuses; this is only so that the person learns it before pressing Start.
 */
export function checkMessages(value: number | null, maxMessages: number): MessagesCheck {
  if (value === null || !Number.isInteger(value) || value < 1 || value > maxMessages) {
    return {
      ok: false,
      reason: `Enter a whole number of messages from 1 to ${formatCount(maxMessages)}.`,
    };
  }
  return { ok: true, messages: value };
}

/**
 * How many readings `messages` messages come to when they are sent to the devices in turn (message `i` to device `i % n`, as the
 * simulator's loop does): each device gets its share, and each message carries one reading per metric of its device. An estimate for the
 * confirmation's sentence ("about"): the simulator counts the run's own `expectedReadings` and that is the figure the page shows
 * once the run exists.
 */
export function expectedReadingsFor(
  messages: number,
  devices: readonly { metrics: readonly unknown[] }[],
): number {
  const n = devices.length;
  if (n === 0 || messages < 1) return 0;
  const each = Math.floor(messages / n);
  const extra = messages % n;
  return devices.reduce(
    (sum, device, index) => sum + device.metrics.length * (each + (index < extra ? 1 : 0)),
    0,
  );
}

export interface CostInput {
  messages: number;
  /** About how many readings the run will write (`expectedReadingsFor`). */
  readings: number;
  /** `host:port/name` of the database a run counts in; never credentials. `null` when the simulator did not say. */
  database: string | null;
}

/**
 * What a run costs, in the sentences of the confirmation: the machine, the database, the lock and what Stop does. Said before the
 * run, in plain words, because a benchmark is not something to start by accident (brief R9).
 */
export function costLines({ messages, readings, database }: CostInput): string[] {
  return [
    `It publishes ${formatCount(messages)} messages as fast as the broker accepts them and uses most of this machine’s CPU and memory until every reading is stored.`,
    `It writes about ${formatCount(readings)} readings to ${database ?? 'the database'}. Nothing deletes them afterwards.`,
    'While it runs, the controls that publish are locked: starting devices, running scenarios, bursts, republishing and Reset.',
    'Stop ends it at any time. What was already published stays published and stored.',
  ];
}

/** The label of the confirming button: it names the size, so the person confirms what they read. */
export const confirmLabel = (messages: number): string => `Start ${formatCount(messages)} messages`;

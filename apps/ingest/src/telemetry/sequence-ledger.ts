/**
 * Counts missing messages per device from their sequence numbers (ADR-0002).
 *
 * The state lives in PostgreSQL (`device.last_seq`, `device.seq_holes`) so every replica works from
 * the same truth. It tolerates what several consumers do to a device's messages: they arrive in any
 * order, and each replica flushes on its own clock.
 *
 * A jump forward opens a *hole* — the range of sequence numbers not seen yet. A late message fills
 * its hole; a hole still open after the grace period is confirmed lost, exactly once.
 *
 * A lower sequence number that fills no hole is either a redelivery or a device restart. The size
 * of the step back cannot tell them apart (a flush that lags by a few seconds is thousands of
 * messages behind a busy device), but the message's own timestamp can: a restart is *newer* than the
 * newest message seen, a redelivery or a late message is older.
 */

/** Inclusive range of sequence numbers not seen yet, and when the jump that opened it was seen (ms). */
export type Hole = [from: number, to: number, openedAt: number];

/** One received message: its sequence number and its timestamp (epoch ms, the device's clock). */
export interface SequenceObservation {
  seq: number;
  ts: number;
}

export interface DeviceSequence {
  /** Highest sequence number of the current run, or null before the first message. */
  last: number | null;
  /** Timestamp of the message that carried `last`. */
  lastTs: number | null;
  holes: Hole[];
}

/**
 * Bound on the state kept per device: past it, the oldest holes are confirmed lost early. Replicas
 * that share a device each see every other message, so a busy device leaves one hole per message
 * its other replicas have not flushed yet: thousands during a burst, a handful at one message per
 * second. Sized for the former (about 330 kB of jsonb at the limit).
 */
export const MAX_HOLES = 10_000;

const size = ([from, to]: Hole) => to - from + 1;

/**
 * Applies the messages one device delivered, in arrival order, and returns the new state and how
 * many messages are newly confirmed lost.
 */
export function applySequences(
  state: DeviceSequence,
  observations: SequenceObservation[],
  now: number,
  graceMs: number,
): { state: DeviceSequence; lost: number } {
  let { last } = state;
  // A ledger row without a timestamp (last_seq set by hand) treats any lower message as a restart.
  let lastTs = state.lastTs ?? Number.NEGATIVE_INFINITY;
  let holes = state.holes.map((hole): Hole => [...hole]);
  let lost = 0;

  for (const { seq, ts } of observations) {
    if (last === null) {
      last = seq;
      lastTs = ts;
    } else if (seq > last) {
      if (seq - last > 1) holes.push([last + 1, seq - 1, now]);
      last = seq;
      lastTs = ts;
    } else if (!fill(holes, seq) && ts > lastTs) {
      // The device restarted its counter: what the previous run never delivered is lost.
      lost += holes.reduce((sum, hole) => sum + size(hole), 0);
      holes = [];
      last = seq;
      lastTs = ts;
    }
    // Otherwise a redelivery (or a message from before the first one seen): ignored.
  }

  const open: Hole[] = [];
  for (const hole of holes) {
    if (now - hole[2] >= graceMs) lost += size(hole);
    else open.push(hole);
  }
  while (open.length > MAX_HOLES) lost += size(open.shift()!);

  return {
    state: { last, lastTs: Number.isFinite(lastTs) ? lastTs : null, holes: open },
    lost,
  };
}

/** Removes `seq` from the hole that contains it. Returns false when no hole does. */
function fill(holes: Hole[], seq: number): boolean {
  const index = holes.findIndex(([from, to]) => seq >= from && seq <= to);
  if (index < 0) return false;
  const [from, to, openedAt] = holes[index];
  const rest: Hole[] = [];
  if (from < seq) rest.push([from, seq - 1, openedAt]);
  if (seq < to) rest.push([seq + 1, to, openedAt]);
  holes.splice(index, 1, ...rest);
  return true;
}

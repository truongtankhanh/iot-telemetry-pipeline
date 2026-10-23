import { useCallback, useState } from 'react';
import type { MessageRow } from '../../lib/messageRows';

export interface TailInput {
  /** The log's rows, newest first (what Clear left). */
  rows: readonly MessageRow[];
  /** Every message published so far; the difference since the tail was held is how many arrived. */
  total: number;
  /** Clear hid every message up to this id; a held list drops them too. */
  clearedBefore: number;
  /** The page the table is on, 1-based. */
  page: number;
}

export interface MessageTail {
  /** What the table filters and pages: the live rows, or the held copy. */
  rows: readonly MessageRow[];
  /** Page 1 and not paused: the table moves with the stream. */
  following: boolean;
  /** Paused by the button. Leaving page 1 holds the tail too, but is not this. */
  paused: boolean;
  /** Messages published since the tail was held; 0 while it follows. */
  newSinceHeld: number;
  pause(): void;
  /** Ends a pause by the button. On a page other than 1 the tail follows again only on page 1: the page goes there. */
  resume(): void;
}

interface Held {
  rows: readonly MessageRow[];
  total: number;
}

/**
 * The live tail of the Event stream. Page 1 follows the stream; leaving it, or pressing Pause, holds a copy of the rows as they
 * were, so a row does not move under a pointer or a reader (and page 2 stays page 2). Coming back to page 1, or pressing Resume
 * there, follows again. What Clear hid is dropped from a held copy as well, or Clear would seem to do nothing while paused.
 */
export function useMessageTail({ rows, total, clearedBefore, page }: TailInput): MessageTail {
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState<Held | null>(null);
  const holding = paused || page !== 1;

  // The copy is taken in the render that starts the hold, which is the moment of the click, and dropped when it ends.
  // (Setting state while rendering is React's way of deriving state from a change in props: it renders again at once.)
  if (holding && held === null) setHeld({ rows, total });
  if (!holding && held !== null) setHeld(null);

  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => setPaused(false), []);

  const source = holding ? (held ?? { rows, total }) : { rows, total };
  return {
    rows: holding ? source.rows.filter((row) => row.id > clearedBefore) : rows,
    following: !holding,
    paused,
    newSinceHeld: holding ? Math.max(0, total - source.total) : 0,
    pause,
    resume,
  };
}

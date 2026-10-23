import { useCallback, useRef, useState } from 'react';
import { republishMessage } from '../../api/client';
import type { PublishedMessage } from '../../api/types';
import { useStudioStore } from '../../state/studioContext';

/** What the last republish came to, and of which message (`of` is the id that was sent again). */
export type RepublishResult =
  | { kind: 'sent'; of: number; message: PublishedMessage }
  | { kind: 'error'; of: number; text: string };

/**
 * Sends a message of the log again, as the Event stream's button does. It keeps what a control needs to show: whether one is
 * on its way (a second press while it is, is ignored) and what the last one came to, with the simulator's own words when it
 * refused (`404` no longer in the last 200, `409` link down, `502` broker refused). The answer is the new state, and goes into
 * the store at once, so the effect session a republish starts is on the Faults page without waiting for the stream.
 */
export function useRepublish() {
  const store = useStudioStore();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RepublishResult | null>(null);
  const running = useRef(false);

  /** Resolves true when the simulator sent it. */
  const republish = useCallback(
    async (id: number): Promise<boolean> => {
      if (running.current) return false;
      running.current = true;
      setBusy(true);
      try {
        const { message, ...view } = await republishMessage(id);
        store.getState().setView(view, Date.now());
        setResult({ kind: 'sent', of: id, message });
        return true;
      } catch (error) {
        setResult({
          kind: 'error',
          of: id,
          text: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [store],
  );

  /** Forgets the last result (another message was chosen). */
  const clear = useCallback(() => setResult(null), []);

  return { busy, result, republish, clear };
}

export type Republish = ReturnType<typeof useRepublish>;

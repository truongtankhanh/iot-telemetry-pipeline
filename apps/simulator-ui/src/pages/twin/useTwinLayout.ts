import { useCallback, useEffect, useState } from 'react';
import { ApiError, getTwinLayout } from '../../api/client';
import type { TwinLayoutView } from '../../api/types';

export interface TwinLayoutResult {
  /** `loading` is for the read asked for now; `ready` also holds a layout that is not available (that is an answer). */
  status: 'loading' | 'ready' | 'error';
  /** The simulator's answer, once `status` is `ready`. */
  view: TwinLayoutView | null;
  /** Why the read failed (the simulator's message, or that it is too old), while `status` is `error`. */
  error: string | null;
  /** Asks again, after an error. */
  retry(): void;
}

interface Answer {
  /** The request this answers. */
  attempt: number;
  view: TwinLayoutView | null;
  error: string | null;
}

/**
 * The twin layout, read from the simulator once when the page opens and again on `retry()`; there is no timer, because
 * the simulator reads its layout file once at start and it does not change while it runs. A read that is overtaken (a
 * retry, leaving the page) is aborted and its answer is never shown. It keeps nothing in the store: only the twin page
 * needs it.
 */
export function useTwinLayout(): TwinLayoutResult {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getTwinLayout({ signal: controller.signal }).then(
      (view) => {
        if (controller.signal.aborted) return;
        setAnswer({ attempt, view, error: null });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof ApiError ? error.message : 'The twin layout could not be read';
        setAnswer({ attempt, view: null, error: message });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  // Only the answer to the request asked for now counts; an earlier one is gone.
  const current = answer !== null && answer.attempt === attempt ? answer : null;
  const status: TwinLayoutResult['status'] =
    current === null ? 'loading' : current.error === null ? 'ready' : 'error';
  return { status, view: current?.view ?? null, error: current?.error ?? null, retry };
}

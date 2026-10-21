import { useCallback, useEffect, useState } from 'react';
import { ApiError, getScenarios } from '../../api/client';
import type { ScenarioLibraryView, StateView } from '../../api/types';
import { useStudio } from '../../state/studioContext';

export interface ScenarioLibraryResult {
  /**
   * The library on show: the last one that loaded, kept while the next loads or fails, so a refresh or an error never
   * blanks the cards. `null` only before the first read has arrived.
   */
  library: ScenarioLibraryView | null;
  /** `loading` is for the read asked for now; `library` may still hold an earlier one. */
  status: 'loading' | 'ready' | 'error';
  /** Why the last read failed (the simulator's message), while `status` is `error`. */
  error: string | null;
  /** When the library on show was fetched (ms), or `null` before any. */
  fetchedAt: number | null;
  /** Asks again, also after an error. */
  refresh(): void;
}

interface Answer {
  /** The request this answers. */
  key: string;
  library: ScenarioLibraryView | null;
  error: string | null;
  fetchedAt: number | null;
}

/**
 * What changes what a card says: which runs are playing, and each device's state and interval (they decide `running`,
 * `needsStart` and the times of the expected alerts). `null` before the first state has arrived. It is a string so that a
 * component subscribed to it renders again only when it changes, not at every refresh of the state.
 */
export function librarySignature(view: StateView | null): string | null {
  if (view === null) return null;
  const runs = view.runs.map((run) => run.id).join(',');
  const devices = view.engine.devices
    .map((device) => `${device.id}:${device.state}:${device.intervalMs}`)
    .join(',');
  return `${runs}|${devices}`;
}

/**
 * The scenario library, read from the simulator. It is read once the first state has arrived and again whenever the
 * signature above changes, and on `refresh()` (the page asks after each of its own commands, since an import adds a
 * scenario without changing the signature); there is no timer. A request that is overtaken (a new signature, leaving the
 * page) is aborted, and an answer to a request that is no longer current is never shown.
 */
export function useScenarioLibrary(): ScenarioLibraryResult {
  const signature = useStudio((state) => librarySignature(state.view));
  const [retries, setRetries] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const requestKey = `${signature ?? ''}|${retries}`;

  useEffect(() => {
    if (signature === null) return;
    const controller = new AbortController();
    getScenarios({ signal: controller.signal }).then(
      (library) => {
        if (controller.signal.aborted) return;
        setAnswer({ key: requestKey, library, error: null, fetchedAt: Date.now() });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          error instanceof ApiError ? error.message : 'The scenarios could not be read';
        setAnswer((previous) => ({
          key: requestKey,
          library: previous?.library ?? null,
          error: message,
          fetchedAt: previous?.fetchedAt ?? null,
        }));
      },
    );
    return () => controller.abort();
  }, [signature, requestKey]);

  const refresh = useCallback(() => setRetries((count) => count + 1), []);

  // The answer to the request asked for now; an earlier answer only supplies the library to keep on show.
  const current = answer !== null && answer.key === requestKey ? answer : null;
  const status: ScenarioLibraryResult['status'] =
    signature === null || current === null ? 'loading' : current.error === null ? 'ready' : 'error';

  return {
    library: answer?.library ?? null,
    status,
    error: current?.error ?? null,
    fetchedAt: answer?.fetchedAt ?? null,
    refresh,
  };
}

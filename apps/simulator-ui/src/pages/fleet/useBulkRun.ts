import { useCallback, useEffect, useRef, useState } from 'react';
import type { StateView } from '../../api/types';
import { type BulkResult, runBulk } from '../../lib/bulk';
import { useStudioStore } from '../../state/studioContext';

export interface BulkState {
  /** What is being done, in words ("Pausing"), while it runs. */
  label: string | null;
  done: number;
  total: number;
  running: boolean;
  /** The results of the last run, kept until dismissed so a failure can be read. */
  results: BulkResult[];
}

const IDLE: BulkState = { label: null, done: 0, total: 0, running: false, results: [] };

/**
 * Runs one command for many devices, one after another, with progress. Each answer (a whole state view) goes into
 * the store as it arrives, so the cards change while the run goes on. Leaving the page stops the run before the
 * next device. Only one run at a time: a second request while one is going is refused (`run` resolves `null`).
 */
export function useBulkRun() {
  const store = useStudioStore();
  const [state, setState] = useState<BulkState>(IDLE);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (
      ids: readonly string[],
      label: string,
      send: (id: string) => Promise<StateView>,
    ): Promise<BulkResult[] | null> => {
      if (controller.current) return null;
      const abort = new AbortController();
      controller.current = abort;
      setState({ label, done: 0, total: ids.length, running: true, results: [] });
      const results = await runBulk(
        ids,
        async (id) => {
          const view = await send(id);
          store.getState().setView(view, Date.now());
        },
        {
          signal: abort.signal,
          onProgress: (done, total) => setState((was) => ({ ...was, done, total })),
        },
      );
      controller.current = null;
      setState({ label, done: results.length, total: ids.length, running: false, results });
      return results;
    },
    [store],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);
  const dismiss = useCallback(() => setState(IDLE), []);

  return { state, run, cancel, dismiss };
}

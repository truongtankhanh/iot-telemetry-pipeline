/** A run on more devices than this asks first: "Stop all" on a hundred devices is not one click. */
export const BULK_CONFIRM_ABOVE = 10;

/** What a bulk action does to a device. */
export type BulkAction = 'pause' | 'start' | 'stop';

/** The words of each action, for the question before it, its progress and its result. */
export const BULK_WORDS: Record<BulkAction, { verb: string; doing: string; done: string }> = {
  pause: { verb: 'Pause', doing: 'Pausing', done: 'Paused' },
  start: { verb: 'Start', doing: 'Starting', done: 'Started' },
  stop: { verb: 'Stop', doing: 'Stopping', done: 'Stopped' },
};

/** What one item of a bulk run did. */
export interface BulkResult {
  id: string;
  ok: boolean;
  /** The message of the failure, when `ok` is false. */
  error?: string;
}

export interface BulkOptions {
  /** Called after each item with how many are done of the total, and the item's result. */
  onProgress?: (done: number, total: number, result: BulkResult) => void;
  /** Stops before the next item; the item already started finishes. */
  signal?: AbortSignal;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Runs `run` for each id, one after another. Every command answers with a whole state view that the
 * simulator builds, so a hundred at once would be a hundred views in flight; in sequence the page also
 * shows true progress, and a failure on one device (it was removed, the link dropped) does not stop the
 * rest. The results are in the order of the ids, and only the items that ran are in them: after an abort
 * the rest are left out, not marked failed.
 */
export async function runBulk(
  ids: readonly string[],
  run: (id: string) => Promise<unknown>,
  options: BulkOptions = {},
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const id of ids) {
    if (options.signal?.aborted) break;
    let result: BulkResult;
    try {
      await run(id);
      result = { id, ok: true };
    } catch (error) {
      result = { id, ok: false, error: messageOf(error) };
    }
    results.push(result);
    options.onProgress?.(results.length, ids.length, result);
  }
  return results;
}

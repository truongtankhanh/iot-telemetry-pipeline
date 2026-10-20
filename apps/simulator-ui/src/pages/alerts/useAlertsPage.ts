import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, getAlerts } from '../../api/client';
import type { AlertsPage, ObservedAlert } from '../../api/types';
import type { AlertStatusFilter } from '../../lib/alertsQuery';
import {
  canGoNewer,
  canGoOlder,
  type CursorStack,
  cursorOf,
  goNewer,
  goOlder,
  NEWEST_PAGE,
} from '../../lib/cursorPaging';
import { useStudio } from '../../state/studioContext';

export interface AlertsPageQuery {
  status: AlertStatusFilter;
  size: number;
}

export interface AlertsPageResult {
  /**
   * The page on show: the last one that loaded, kept while the next loads or fails, so a refresh or an error
   * never blanks the list. `null` only before the first page has arrived.
   */
  page: AlertsPage | null;
  /** `loading` is for the page asked for now; `page` may still hold an earlier one. */
  status: 'loading' | 'ready' | 'error';
  /** Why the last request failed (the simulator's message), while `status` is `error`. */
  error: string | null;
  /** When the page on show was fetched (ms), or `null` before any. */
  fetchedAt: number | null;
  stack: CursorStack;
  canNewer: boolean;
  canOlder: boolean;
  older(): void;
  newer(): void;
  /** Back to the newest page from wherever it is, also from a page that failed (a cursor ingest no longer accepts). */
  newest(): void;
  /** Asks again for the page that failed. */
  retry(): void;
}

interface Answer {
  /** The request this answers. */
  key: string;
  page: AlertsPage | null;
  error: string | null;
  fetchedAt: number | null;
}

/** What changes the first page: a new alert, or an alert that cleared or whose delivery moved. */
function signatureOf(alerts: readonly ObservedAlert[] | undefined): string {
  if (alerts === undefined) return '';
  return alerts.map((a) => `${a.id}:${a.status}:${a.deliveryStatus ?? ''}`).join('|');
}

/**
 * One page of alerts at a time, through the simulator. The cursors are the ones the API handed out, kept in memory
 * (`Older` pushes the page's `next`, `Newer` pops); a new filter or size starts again at the newest page. A request
 * that is overtaken (another click, a new filter, leaving the page) is aborted, and an answer to a request that is
 * no longer current is never shown. The newest page asks again when the store hears of a new or changed alert;
 * older pages are snapshots (the caller lays the store's fresher fields over their rows).
 */
export function useAlertsPage({ status, size }: AlertsPageQuery): AlertsPageResult {
  const feed = useStudio((state) => state.view?.alerts.alerts);
  const signature = useMemo(() => signatureOf(feed), [feed]);

  const queryKey = `${status}|${size}`;
  const [paging, setPaging] = useState<{ key: string; stack: CursorStack }>({
    key: queryKey,
    stack: NEWEST_PAGE,
  });
  // A stack made for another filter or size means nothing here: derived during render, not corrected in an effect.
  const stack = paging.key === queryKey ? paging.stack : NEWEST_PAGE;
  const cursor = cursorOf(stack);

  const [retries, setRetries] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const refresh = stack.length === 0 ? signature : '';
  const requestKey = `${queryKey}|${cursor ?? ''}|${refresh}|${retries}`;

  useEffect(() => {
    const controller = new AbortController();
    getAlerts(
      {
        ...(status === 'open' ? { status: 'open' as const } : {}),
        limit: size,
        ...(cursor === undefined ? {} : { before: cursor }),
      },
      { signal: controller.signal },
    ).then(
      (page) => {
        if (controller.signal.aborted) return;
        setAnswer({ key: requestKey, page, error: null, fetchedAt: Date.now() });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof ApiError ? error.message : 'The alerts could not be read';
        setAnswer((previous) => ({
          key: requestKey,
          page: previous?.page ?? null,
          error: message,
          fetchedAt: previous?.fetchedAt ?? null,
        }));
      },
    );
    return () => controller.abort();
  }, [status, size, cursor, requestKey]);

  // The answer to the request asked for now; an earlier answer only supplies the page to keep on show.
  const current = answer !== null && answer.key === requestKey ? answer : null;
  const result: AlertsPageResult['status'] =
    current === null ? 'loading' : current.error === null ? 'ready' : 'error';
  const page = answer?.page ?? null;

  const older = useCallback(() => {
    if (result !== 'ready' || page === null) return;
    setPaging({ key: queryKey, stack: goOlder(stack, page.next) });
  }, [result, page, queryKey, stack]);

  const newer = useCallback(() => {
    if (result === 'loading') return;
    setPaging({ key: queryKey, stack: goNewer(stack) });
  }, [result, queryKey, stack]);

  const newest = useCallback(() => setPaging({ key: queryKey, stack: NEWEST_PAGE }), [queryKey]);

  const retry = useCallback(() => setRetries((count) => count + 1), []);

  return {
    page,
    status: result,
    error: current?.error ?? null,
    fetchedAt: answer?.fetchedAt ?? null,
    stack,
    canNewer: canGoNewer(stack),
    canOlder: page !== null && canGoOlder(page.next),
    older,
    newer,
    newest,
    retry,
  };
}

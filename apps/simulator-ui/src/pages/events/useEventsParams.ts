import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  type MessageQuery,
  parseMessageQuery,
  serializeMessageQuery,
} from '../../lib/messageQuery';

export interface UpdateOptions {
  /** Replace the history entry instead of adding one. A filter replaces; opening a message adds, so Back closes it. */
  replace?: boolean;
  /** Keep the page number. By default a change goes back to page 1, since the list under it changed. */
  keepPage?: boolean;
}

/** The query without the note about the address it came from. */
function queryOf(parsed: ReturnType<typeof parseMessageQuery>): MessageQuery {
  const { q, device, metric, page, size, message } = parsed;
  return { q, device, metric, page, size, message };
}

/**
 * The query of the Event stream, read from and written to the address. The address is the state: the filters, the page, its
 * size and the open message survive a reload and a shared link, and Back and Forward move through them.
 *
 * The command palette writes `?topic=<topic>`; that is read as the text filter and the address is rewritten to `?q=` once,
 * replacing the entry, so Back does not return to the alias.
 */
export function useEventsParams(): [
  MessageQuery,
  (patch: Partial<MessageQuery>, options?: UpdateOptions) => void,
] {
  const [params, setParams] = useSearchParams();
  const parsed = useMemo(() => parseMessageQuery(params), [params]);
  const query = useMemo(() => queryOf(parsed), [parsed]);

  useEffect(() => {
    if (parsed.aliased) setParams(serializeMessageQuery(query), { replace: true });
  }, [parsed.aliased, query, setParams]);

  const update = useCallback(
    (patch: Partial<MessageQuery>, options: UpdateOptions = {}) => {
      setParams(
        (current) => {
          const next = { ...queryOf(parseMessageQuery(current)), ...patch };
          if (!options.keepPage && patch.page === undefined) next.page = 1;
          return serializeMessageQuery(next);
        },
        { replace: options.replace ?? true },
      );
    },
    [setParams],
  );

  return [query, update];
}

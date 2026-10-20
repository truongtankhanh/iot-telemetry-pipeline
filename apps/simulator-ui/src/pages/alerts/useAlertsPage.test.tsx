import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import alertsPageFixture from '../../api/fixtures/alerts-page.json';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { PagedAlert } from '../../api/types';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type StudioStore } from '../../state/store';
import { type AlertsPageQuery, useAlertsPage } from './useAlertsPage';

const rows = alertsPageFixture as unknown as PagedAlert[];

afterEach(() => vi.unstubAllGlobals());

interface Call {
  url: string;
  signal: AbortSignal | undefined;
}

type Handler = (call: Call) => Promise<Response> | Response;

const page = (alerts: PagedAlert[], next: string | null = null): Response =>
  new Response(JSON.stringify(alerts), {
    status: 200,
    ...(next === null ? {} : { headers: { 'X-Next-Cursor': next } }),
  });

const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ statusCode: status, error: 'Bad Gateway', message }), { status });

/** The simulator, as `fetch` sees it: every request is recorded, and `handler` answers it. */
function setup(
  handler: Handler,
  initialProps: AlertsPageQuery = { status: 'all', size: 25 },
): {
  calls: Call[];
  store: StudioStore;
  hook: ReturnType<typeof renderHook<ReturnType<typeof useAlertsPage>, AlertsPageQuery>>;
} {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, signal: init?.signal ?? undefined };
      calls.push(call);
      return handler(call);
    }),
  );
  const store = createStudioStore();
  store.getState().setView(structuredClone(stateViewFixture), 1);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store}>{children}</StudioProvider>
  );
  const hook = renderHook((props: AlertsPageQuery) => useAlertsPage(props), {
    initialProps,
    wrapper,
  });
  return { calls, store, hook };
}

const ready = (hook: ReturnType<typeof setup>['hook']) =>
  waitFor(() => expect(hook.result.current.status).toBe('ready'));

const urls = (calls: Call[]) => calls.map((call) => call.url);

describe('useAlertsPage', () => {
  it('asks for the newest page, 25 alerts, and shows it with the time it was fetched', async () => {
    const { calls, hook } = setup(() => page(rows));
    expect(hook.result.current.status).toBe('loading');
    expect(hook.result.current.page).toBeNull();

    await ready(hook);

    expect(urls(calls)).toEqual(['/api/alerts?limit=25']);
    expect(hook.result.current.page?.alerts.map((alert) => alert.id)).toEqual(['7', '6']);
    expect(hook.result.current.fetchedAt).not.toBeNull();
    expect(hook.result.current.canNewer).toBe(false);
    expect(hook.result.current.canOlder).toBe(false);
  });

  it('asks ingest for open alerts only on the Open filter, and for the size it was given', async () => {
    const { calls, hook } = setup(() => page(rows), { status: 'open', size: 5 });
    await ready(hook);
    expect(urls(calls)).toEqual(['/api/alerts?status=open&limit=5']);
  });

  it('goes older with the cursor it was given and newer back to the first page', async () => {
    const { calls, hook } = setup(({ url }) =>
      url.includes('before=c1') ? page([rows[1]!]) : page([rows[0]!], 'c1'),
    );
    await ready(hook);
    expect(hook.result.current.canOlder).toBe(true);

    act(() => hook.result.current.older());
    await waitFor(() => expect(hook.result.current.page?.alerts[0]?.id).toBe('6'));
    expect(urls(calls)).toEqual(['/api/alerts?limit=25', '/api/alerts?limit=25&before=c1']);
    expect(hook.result.current.canNewer).toBe(true);
    expect(hook.result.current.canOlder).toBe(false);

    act(() => hook.result.current.newer());
    await waitFor(() => expect(hook.result.current.page?.alerts[0]?.id).toBe('7'));
    expect(calls.at(-1)?.url).toBe('/api/alerts?limit=25');
    expect(hook.result.current.canNewer).toBe(false);
  });

  it('does nothing when asked to go older without a cursor, or newer from the newest page', async () => {
    const { calls, hook } = setup(() => page(rows));
    await ready(hook);
    act(() => hook.result.current.older());
    act(() => hook.result.current.newer());
    expect(calls).toHaveLength(1);
    expect(hook.result.current.stack).toEqual([]);
  });

  it('does not stack the same cursor twice when Older is pressed again before the page arrives', async () => {
    let release: (response: Response) => void = () => {};
    const { calls, hook } = setup(({ url }) =>
      url.includes('before=')
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : page(rows, 'c1'),
    );
    await ready(hook);
    act(() => hook.result.current.older());
    act(() => hook.result.current.older());
    expect(hook.result.current.stack).toEqual(['c1']);
    release(page(rows));
    await ready(hook);
    expect(calls.filter((call) => call.url.includes('before='))).toHaveLength(1);
  });

  it('starts again at the newest page when the filter or the size changes', async () => {
    const { calls, hook } = setup(({ url }) =>
      url.includes('before=') ? page(rows) : page(rows, 'c1'),
    );
    await ready(hook);
    act(() => hook.result.current.older());
    await waitFor(() => expect(hook.result.current.stack).toEqual(['c1']));
    await ready(hook);

    hook.rerender({ status: 'open', size: 25 });
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/alerts?status=open&limit=25'));
    expect(hook.result.current.stack).toEqual([]);

    hook.rerender({ status: 'open', size: 10 });
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/alerts?status=open&limit=10'));
  });

  it('aborts the request it is overtaken by, and never shows its late answer', async () => {
    let releaseFirst: (response: Response) => void = () => {};
    const { calls, hook } = setup(({ url }) =>
      url.includes('limit=25')
        ? new Promise<Response>((resolve) => {
            releaseFirst = resolve;
          })
        : page([rows[1]!]),
    );
    await waitFor(() => expect(calls).toHaveLength(1));

    hook.rerender({ status: 'all', size: 5 });
    await ready(hook);
    expect(calls[0]?.signal?.aborted).toBe(true);

    await act(async () => releaseFirst(page([rows[0]!])));
    expect(hook.result.current.page?.alerts.map((alert) => alert.id)).toEqual(['6']);
  });

  it('aborts the request in flight when the page is left', async () => {
    const { calls, hook } = setup(() => new Promise<Response>(() => {}));
    await waitFor(() => expect(calls).toHaveLength(1));
    hook.unmount();
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('keeps the page on show when the next request fails, says why, and asks again on retry', async () => {
    let attempt = 0;
    const { calls, store, hook } = setup(() => {
      attempt++;
      return attempt === 2 ? failure(502, 'ECONNREFUSED') : page(rows);
    });
    await ready(hook);

    act(() =>
      store.getState().patchSlice(
        'alerts',
        {
          ...stateViewFixture.alerts,
          alerts: [{ ...stateViewFixture.alerts.alerts[0]!, id: '99' }],
        },
        2,
      ),
    );
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.error).toBe('ECONNREFUSED');
    expect(hook.result.current.page?.alerts).toHaveLength(2);

    act(() => hook.result.current.retry());
    await ready(hook);
    expect(hook.result.current.error).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it('says it could not read the alerts when the failure is not the simulator’s answer', async () => {
    const { hook } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.error).toBe('Cannot reach the simulator');
    expect(hook.result.current.page).toBeNull();
  });

  describe('as alerts change in the store', () => {
    const withNewAlert = (store: StudioStore) =>
      act(() =>
        store.getState().patchSlice(
          'alerts',
          {
            ...stateViewFixture.alerts,
            alerts: [
              { ...stateViewFixture.alerts.alerts[0]!, id: String(Date.now()) },
              ...stateViewFixture.alerts.alerts,
            ],
          },
          3,
        ),
      );

    it('asks for the newest page again when a new alert arrives', async () => {
      const { calls, store, hook } = setup(() => page(rows));
      await ready(hook);
      withNewAlert(store);
      await waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]?.url).toBe('/api/alerts?limit=25');
    });

    it('does not ask again when the store says what it already said', async () => {
      const { calls, store, hook } = setup(() => page(rows));
      await ready(hook);
      act(() => store.getState().patchSlice('alerts', structuredClone(stateViewFixture.alerts), 3));
      expect(calls).toHaveLength(1);
    });

    it('leaves an older page alone: its rows are a snapshot, the caller overlays the live fields', async () => {
      const { calls, store, hook } = setup(({ url }) =>
        url.includes('before=') ? page(rows) : page(rows, 'c1'),
      );
      await ready(hook);
      act(() => hook.result.current.older());
      await waitFor(() => expect(calls).toHaveLength(2));
      await ready(hook);

      withNewAlert(store);
      await Promise.resolve();
      expect(calls).toHaveLength(2);
    });
  });
});

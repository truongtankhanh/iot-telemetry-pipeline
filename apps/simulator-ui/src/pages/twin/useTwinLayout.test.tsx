import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { twinLayoutFixture } from '../../api/fixtures/twinLayout';
import type { TwinLayoutView } from '../../api/types';
import { useTwinLayout } from './useTwinLayout';

afterEach(() => vi.unstubAllGlobals());

interface Call {
  url: string;
  signal: AbortSignal | undefined;
}

type Handler = (call: Call) => Promise<Response> | Response;

const answer = (body: unknown = twinLayoutFixture): Response => new Response(JSON.stringify(body));

const failure = (status: number, message: string) =>
  new Response(JSON.stringify({ statusCode: status, error: 'Error', message }), { status });

const UNAVAILABLE: TwinLayoutView = {
  available: false,
  reason: 'cannot read /x/twin-layout.json (ENOENT)',
  layout: null,
  placement: { placed: [], unplaced: [], orphans: [] },
};

/** The simulator, as `fetch` sees it: every request is recorded, and `handler` answers it. */
function setup(handler: Handler) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url, signal: init?.signal ?? undefined };
      calls.push(call);
      return handler(call);
    }),
  );
  return { calls, hook: renderHook(() => useTwinLayout()) };
}

describe('useTwinLayout', () => {
  it('is loading, reads the layout once, and then has the view', async () => {
    const { calls, hook } = setup(() => answer());
    expect(hook.result.current.status).toBe('loading');
    expect(hook.result.current.view).toBeNull();
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(hook.result.current.view).toEqual(twinLayoutFixture);
    expect(hook.result.current.error).toBeNull();
    expect(calls.map((call) => call.url)).toEqual(['/api/twin-layout']);
  });

  it('is ready, not an error, when the simulator says the layout is not available', async () => {
    const { hook } = setup(() => answer(UNAVAILABLE));
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(hook.result.current.view?.available).toBe(false);
    expect(hook.result.current.view?.reason).toBe('cannot read /x/twin-layout.json (ENOENT)');
  });

  it('shows the simulator’s message when it refuses, and says a simulator without the route is too old', async () => {
    const refused = setup(() => failure(403, 'The Host header must name this machine'));
    await waitFor(() => expect(refused.hook.result.current.status).toBe('error'));
    expect(refused.hook.result.current.error).toBe('The Host header must name this machine');
    expect(refused.hook.result.current.view).toBeNull();
    refused.hook.unmount();

    const old = setup(() => failure(404, 'No such route'));
    await waitFor(() => expect(old.hook.result.current.status).toBe('error'));
    expect(old.hook.result.current.error).toMatch(/too old for the twin/);
  });

  it('says it could not reach the simulator when there is no answer at all', async () => {
    const { hook } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.error).toBe('Cannot reach the simulator');
  });

  it('reads again on retry, and is loading in between', async () => {
    let attempt = 0;
    const { calls, hook } = setup(() => {
      attempt += 1;
      return attempt === 1 ? failure(500, 'The layout could not be read') : answer();
    });
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    act(() => hook.result.current.retry());
    expect(hook.result.current.status).toBe('loading');
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(hook.result.current.error).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('aborts a read that is still going when the page is left', () => {
    const { calls, hook } = setup(() => new Promise<Response>(() => {}));
    expect(calls[0]?.signal?.aborted).toBe(false);
    hook.unmount();
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('never shows the answer to a read that a retry overtook', async () => {
    let release: (response: Response) => void = () => {};
    let attempt = 0;
    const { calls, hook } = setup(() => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return answer(UNAVAILABLE);
    });
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(calls[0]?.signal?.aborted).toBe(true);

    // The first read answers late, with the layout available: it must not replace the second.
    await act(async () => {
      release(answer());
    });
    expect(hook.result.current.view?.available).toBe(false);
  });
});

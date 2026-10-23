import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { PublishedMessage } from '../../api/types';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { useRepublish } from './useRepublish';

afterEach(() => vi.unstubAllGlobals());

const again: PublishedMessage = {
  id: 9,
  at: '2026-10-23T08:00:00.000Z',
  ackMs: 3.1,
  deviceId: 'dc-env-01',
  topic: 'campus/BLD-DC/dc-env-01/telemetry',
  payload: '{"seq":1}',
  seq: 1,
  ts: '2026-10-23T07:59:58.000Z',
  fault: 'republish',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function setup(fetchFn: (url: string, init: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchFn);
  vi.stubGlobal('fetch', fetchMock);
  const store = createStudioStore();
  store.getState().setView(structuredClone(stateViewFixture), 1);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store}>{children}</StudioProvider>
  );
  const hook = renderHook(() => useRepublish(), { wrapper });
  return { store, hook, fetchMock };
}

describe('useRepublish', () => {
  it('is idle at the start', () => {
    const { hook } = setup(async () => json({}));
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.result).toBeNull();
  });

  it('sends the message again, keeps what came back, and puts the state in the store without the message', async () => {
    const view = {
      ...structuredClone(stateViewFixture),
      faultEffect: { since: 'now', baseline: [] },
    };
    const { store, hook, fetchMock } = setup(async () => json({ ...view, message: again }));

    let accepted = false;
    await act(async () => {
      accepted = await hook.result.current.republish(4);
    });

    expect(accepted).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/messages/4/republish');
    expect(hook.result.current.result).toEqual({ kind: 'sent', of: 4, message: again });
    expect(hook.result.current.busy).toBe(false);
    const stored = store.getState().view as unknown as Record<string, unknown>;
    expect(stored.faultEffect).toEqual({ since: 'now', baseline: [] });
    expect(stored).not.toHaveProperty('message');
  });

  it('is busy while the request is out, and ignores a second press', async () => {
    let release: (response: Response) => void = () => {};
    const { hook, fetchMock } = setup(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = hook.result.current.republish(1);
    });
    expect(hook.result.current.busy).toBe(true);

    let second = true;
    await act(async () => {
      second = await hook.result.current.republish(1);
    });
    expect(second).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(json({ ...structuredClone(stateViewFixture), message: again }));
      await first;
    });
    expect(hook.result.current.busy).toBe(false);
  });

  it('shows the simulator’s words when it refuses, and leaves the state alone', async () => {
    const { store, hook } = setup(async () =>
      json(
        {
          statusCode: 404,
          error: 'Not Found',
          message: 'Message 4 is not in the publish log; only the last 200 are kept',
        },
        404,
      ),
    );
    const before = store.getState().view;

    let accepted = true;
    await act(async () => {
      accepted = await hook.result.current.republish(4);
    });

    expect(accepted).toBe(false);
    expect(hook.result.current.result).toEqual({
      kind: 'error',
      of: 4,
      text: 'Message 4 is not in the publish log; only the last 200 are kept',
    });
    expect(store.getState().view).toBe(before);
  });

  it('says so when the simulator cannot be reached', async () => {
    const { hook } = setup(async () => {
      throw new TypeError('Failed to fetch');
    });
    await act(async () => {
      await hook.result.current.republish(1);
    });
    expect(hook.result.current.result?.kind).toBe('error');
  });

  it('replaces the last result with the next, and forgets it on clear', async () => {
    const answers = [
      json({ statusCode: 409, error: 'Conflict', message: 'The link is down' }, 409),
      json({ ...structuredClone(stateViewFixture), message: again }),
    ];
    const { hook } = setup(async () => answers.shift() as Response);

    await act(async () => {
      await hook.result.current.republish(1);
    });
    expect(hook.result.current.result).toMatchObject({ kind: 'error', text: 'The link is down' });

    await act(async () => {
      await hook.result.current.republish(1);
    });
    expect(hook.result.current.result?.kind).toBe('sent');

    act(() => hook.result.current.clear());
    expect(hook.result.current.result).toBeNull();
  });
});

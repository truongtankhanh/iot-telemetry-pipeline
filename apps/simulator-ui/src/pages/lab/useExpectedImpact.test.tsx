import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import expectationsFixture from '../../api/fixtures/expectations.json';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { Anomaly } from '../../api/types';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { useExpectedImpact } from './useExpectedImpact';

afterEach(() => vi.unstubAllGlobals());

const anomaly = (change: Partial<Anomaly> = {}): Anomaly => ({
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 20,
  duration: 60,
  ...change,
});

interface Call {
  body: { anomalies: Anomaly[] };
  signal: AbortSignal | undefined;
}

type Handler = (call: Call) => Promise<Response> | Response;

const answer = (body: unknown = expectationsFixture) => new Response(JSON.stringify(body));
const refusal = (message: string) =>
  new Response(JSON.stringify({ statusCode: 400, error: 'Bad Request', message }), { status: 400 });

function setup(handler: Handler, initial: Anomaly[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const call: Call = {
        body: JSON.parse(init?.body as string) as Call['body'],
        signal: init?.signal ?? undefined,
      };
      calls.push(call);
      return handler(call);
    }),
  );
  const store = createStudioStore();
  store.getState().setView(structuredClone(stateViewFixture), 1);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store}>{children}</StudioProvider>
  );
  const hook = renderHook(
    ({ anomalies }: { anomalies: Anomaly[] }) => useExpectedImpact(anomalies, { debounceMs: 20 }),
    { wrapper, initialProps: { anomalies: initial } },
  );
  return { calls, store, hook };
}

describe('useExpectedImpact', () => {
  it('asks nothing for no anomalies', async () => {
    const { calls, hook } = setup(() => answer(), []);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toHaveLength(0);
    expect(hook.result.current).toEqual({
      status: 'idle',
      preview: null,
      fresh: true,
      error: null,
    });
  });

  it('asks once, after a moment, with the anomalies as a list, and holds the answer', async () => {
    const { calls, hook } = setup(() => answer(), [anomaly()]);
    expect(hook.result.current.status).toBe('loading');
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ anomalies: [anomaly()] });
    expect(hook.result.current.preview).toEqual(expectationsFixture);
    expect(hook.result.current.fresh).toBe(true);
  });

  it('asks only about the last of several quick changes', async () => {
    const { calls, hook } = setup(() => answer(), [anomaly({ value: 28 })]);
    hook.rerender({ anomalies: [anomaly({ value: 29 })] });
    hook.rerender({ anomalies: [anomaly({ value: 30 })] });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.anomalies[0]!.value).toBe(30);
  });

  it('does not ask again for the same anomalies in a new array', async () => {
    const { calls, hook } = setup(() => answer(), [anomaly()]);
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    hook.rerender({ anomalies: [anomaly()] });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toHaveLength(1);
  });

  it('aborts a request that is overtaken and never takes its answer for the new one', async () => {
    let release: (response: Response) => void = () => {};
    const { calls, hook } = setup(
      (call) => {
        if (call.body.anomalies[0]!.value === 28)
          return new Promise<Response>((r) => (release = r));
        return answer();
      },
      [anomaly({ value: 28 })],
    );
    await waitFor(() => expect(calls).toHaveLength(1));

    hook.rerender({ anomalies: [anomaly({ value: 31 })] });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    expect(calls[0]!.signal?.aborted).toBe(true);
    release(refusal('too late'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hook.result.current.error).toBeNull();
  });

  it('says what the simulator refused, and keeps the last answer on show, marked as not current', async () => {
    const { hook } = setup(
      (call) =>
        call.body.anomalies.length > 1
          ? refusal('anomalies[1] overlaps anomalies[0] on dc-env-01 temperature_c')
          : answer(),
      [anomaly()],
    );
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    hook.rerender({ anomalies: [anomaly(), anomaly({ startAt: 30 })] });
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.error).toMatch(/overlaps/);
    expect(hook.result.current.preview).toEqual(expectationsFixture);
    expect(hook.result.current.fresh).toBe(false);
  });

  it('asks again when a device changes state, because the times depend on it', async () => {
    const { calls, store, hook } = setup(() => answer(), [anomaly()]);
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));

    const view = structuredClone(stateViewFixture);
    view.engine.devices[0]!.state = 'stopped';
    act(() => store.getState().setView(view, 2));
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('forgets the answer when the list empties', async () => {
    const { hook } = setup(() => answer(), [anomaly()]);
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    hook.rerender({ anomalies: [] });
    expect(hook.result.current).toEqual({
      status: 'idle',
      preview: null,
      fresh: true,
      error: null,
    });
  });
});

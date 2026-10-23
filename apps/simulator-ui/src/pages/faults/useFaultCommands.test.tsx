import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { DEFAULT_DRAFTS } from '../../lib/faultSettings';
import { fakeFaultSimulator, faultState } from './faultsTestSupport';
import { useFaultCommands } from './useFaultCommands';

afterEach(() => vi.unstubAllGlobals());

function setup(initial = faultState()) {
  const sim = fakeFaultSimulator(initial);
  vi.stubGlobal('fetch', sim.fetch);
  const store = createStudioStore();
  store.getState().setView(structuredClone(initial), 1);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store}>{children}</StudioProvider>
  );
  const hook = renderHook(({ faults }) => useFaultCommands(faults), {
    wrapper,
    initialProps: { faults: initial.engine.faults },
  });
  return { sim, store, hook };
}

const faultsOf = (store: ReturnType<typeof createStudioStore>) =>
  store.getState().view?.engine.faults;

describe('useFaultCommands: switching a fault on, changing it and off', () => {
  it('sends the body of the draft and puts the answer in the store at once', async () => {
    const { sim, store, hook } = setup();
    let accepted = false;
    await act(async () => {
      accepted = await hook.result.current.apply('drop', DEFAULT_DRAFTS.drop);
    });
    expect(accepted).toBe(true);
    expect(sim.calls).toEqual([{ method: 'PUT', path: '/api/faults/drop', body: { percent: 5 } }]);
    expect(faultsOf(store)?.drop).toEqual({ percent: 5 });
    expect(store.getState().view?.faultEffect).not.toBeNull();
  });

  it('sends the body of each kind', async () => {
    const { sim, hook } = setup();
    await act(async () => {
      await hook.result.current.apply('malformed', { percent: 3, kinds: ['json', 'range'] });
      await hook.result.current.apply('delay', { delayMs: 500, jitterMs: 100 });
      await hook.result.current.apply('reorder', { window: 4 });
      await hook.result.current.apply('link-loss', { forS: null });
    });
    expect(sim.calls.map((c) => [c.path, c.body])).toEqual([
      ['/api/faults/malformed', { percent: 3, kinds: ['json', 'range'] }],
      ['/api/faults/delay', { delayMs: 500, jitterMs: 100 }],
      ['/api/faults/reorder', { window: 4 }],
      ['/api/faults/link-loss', {}],
    ]);
  });

  it('does not send a draft the simulator would refuse', async () => {
    const { sim, hook } = setup();
    let accepted = true;
    await act(async () => {
      accepted = await hook.result.current.apply('drop', { percent: 0 });
    });
    expect(accepted).toBe(false);
    expect(sim.calls).toEqual([]);
  });

  it('does not send what the engine already has, and counts it as accepted', async () => {
    const { sim, hook } = setup(faultState({ drop: { percent: 5 } }));
    let accepted = false;
    await act(async () => {
      accepted = await hook.result.current.apply('drop', { percent: 5 });
    });
    expect(accepted).toBe(true);
    expect(sim.calls).toEqual([]);
  });

  it('shows what the simulator said under the fault that was refused, and the next success clears it', async () => {
    const { sim, hook } = setup();
    sim.refuseNext(
      (c) => c.path === '/api/faults/link-loss',
      409,
      'This simulator has no broker link it can cut',
    );
    let accepted = true;
    await act(async () => {
      accepted = await hook.result.current.apply('link-loss', { forS: null });
    });
    expect(accepted).toBe(false);
    expect(hook.result.current.errors['link-loss']).toBe(
      'This simulator has no broker link it can cut',
    );

    await act(async () => {
      await hook.result.current.apply('link-loss', { forS: null });
    });
    expect(hook.result.current.errors['link-loss']).toBeUndefined();
  });

  it('says the simulator did not answer for a request that never got one', async () => {
    const { hook } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await act(async () => {
      await hook.result.current.apply('drop', { percent: 5 });
    });
    expect(hook.result.current.errors.drop).toBe('The simulator did not answer');
  });

  it('switches a fault off', async () => {
    const { sim, store, hook } = setup(faultState({ drop: { percent: 5 } }));
    await act(async () => {
      expect(await hook.result.current.turnOff('drop')).toBe(true);
    });
    expect(sim.calls).toEqual([{ method: 'DELETE', path: '/api/faults/drop', body: undefined }]);
    expect(faultsOf(store)?.drop).toBeNull();
  });

  it('marks the control busy while its request is out, and only that one', async () => {
    const { sim, hook } = setup();
    sim.holdNext((c) => c.path === '/api/faults/drop');
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = hook.result.current.apply('drop', { percent: 5 });
    });
    await waitFor(() => expect(hook.result.current.busy.has('drop')).toBe(true));
    expect(hook.result.current.busy.has('duplicate')).toBe(false);
    await act(async () => {
      sim.release();
      await pending;
    });
    expect(hook.result.current.busy.size).toBe(0);
  });
});

describe('useFaultCommands: the scope', () => {
  it('sends all running and a selection', async () => {
    const { sim, store, hook } = setup();
    await act(async () => {
      expect(
        await hook.result.current.setScope({ mode: 'selected', deviceIds: ['dc-env-01'] }),
      ).toBe(true);
    });
    expect(faultsOf(store)?.scope).toEqual({ mode: 'selected', deviceIds: ['dc-env-01'] });
    await act(async () => {
      await hook.result.current.setScope({ mode: 'running' });
    });
    expect(sim.calls.map((c) => c.body)).toEqual([
      { mode: 'selected', deviceIds: ['dc-env-01'] },
      { mode: 'running' },
    ]);
  });

  it('does not send a selection with no device in it, and says nothing about it', async () => {
    const { sim, hook } = setup();
    let accepted = true;
    await act(async () => {
      accepted = await hook.result.current.setScope({ mode: 'selected', deviceIds: [] });
    });
    expect(accepted).toBe(false);
    expect(sim.calls).toEqual([]);
    expect(hook.result.current.errors.scope).toBeUndefined();
  });

  it('shows a refusal under the scope', async () => {
    const { sim, hook } = setup();
    sim.refuseNext((c) => c.path === '/api/faults/scope', 404, 'Unknown device "ghost"');
    await act(async () => {
      await hook.result.current.setScope({ mode: 'selected', deviceIds: ['ghost'] });
    });
    expect(hook.result.current.errors.scope).toBe('Unknown device "ghost"');
  });
});

describe('useFaultCommands: burst, clear all and reset counters', () => {
  it('sends 1,000, tells how many went, and keeps the count out of the store', async () => {
    const { sim, store, hook } = setup();
    await act(async () => {
      expect(await hook.result.current.burst()).toBe(true);
    });
    expect(sim.calls).toEqual([
      { method: 'POST', path: '/api/faults/burst', body: { count: 1000 } },
    ]);
    expect(hook.result.current.notice).toEqual({
      tone: 'ok',
      text: 'Sent 1,000 messages, 0 failed.',
    });
    expect(store.getState().view).not.toHaveProperty('sent');
    expect(store.getState().view).not.toHaveProperty('failed');
  });

  it('calls a burst with failures a problem', async () => {
    const { sim, hook } = setup();
    sim.failedPerBurst = 40;
    await act(async () => {
      await hook.result.current.burst();
    });
    expect(hook.result.current.notice).toEqual({
      tone: 'bad',
      text: 'Sent 960 messages, 40 failed.',
    });
  });

  it('shows the sentence of a burst the devices cannot space, under the burst', async () => {
    const { sim, hook } = setup();
    sim.refuseNext(
      (c) => c.path === '/api/faults/burst',
      400,
      '1000 messages over 1 device(s) is 1000 for one, more than the 499 ms interval of dc-env-01 can space',
    );
    await act(async () => {
      expect(await hook.result.current.burst()).toBe(false);
    });
    expect(hook.result.current.errors.burst).toMatch(/can space/);
    expect(hook.result.current.notice).toBeNull();
  });

  it('clears all faults and says so', async () => {
    const { sim, store, hook } = setup(
      faultState({ drop: { percent: 5 }, delay: { delayMs: 500, jitterMs: 0 }, activeCount: 2 }),
    );
    await act(async () => {
      expect(await hook.result.current.clearAll()).toBe(true);
    });
    expect(sim.calls).toEqual([{ method: 'DELETE', path: '/api/faults', body: undefined }]);
    expect(faultsOf(store)?.activeCount).toBe(0);
    expect(hook.result.current.notice?.text).toMatch(/All faults cleared/);
  });

  it('shows the reason under Clear all when the link would not come back', async () => {
    const { sim, hook } = setup(faultState({ drop: { percent: 5 }, activeCount: 1 }));
    sim.refuseNext(
      (c) => c.path === '/api/faults',
      500,
      'Faults were cleared, but the link could not be restored: no answer from the broker',
    );
    await act(async () => {
      expect(await hook.result.current.clearAll()).toBe(false);
    });
    expect(hook.result.current.errors.clear).toMatch(/link could not be restored/);
  });

  it('starts the counters again from now', async () => {
    const { sim, store, hook } = setup();
    await act(async () => {
      expect(await hook.result.current.resetEffect()).toBe(true);
    });
    expect(sim.calls[0]).toMatchObject({ method: 'POST', path: '/api/faults/effect/reset' });
    expect(store.getState().view?.faultEffect).not.toBeNull();
    expect(hook.result.current.notice?.text).toBe('The counters start again from now.');
  });

  it('lets the page dismiss a notice', async () => {
    const { hook } = setup();
    await act(async () => {
      await hook.result.current.resetEffect();
    });
    act(() => hook.result.current.dismissNotice());
    expect(hook.result.current.notice).toBeNull();
  });
});

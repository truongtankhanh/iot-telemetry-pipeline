import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Anomaly } from '../../api/types';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { fakeLabSimulator, labFleet } from './labTestSupport';
import { useInjection } from './useInjection';

afterEach(() => vi.unstubAllGlobals());

const anomaly = (deviceId: string, startAt: number, change: Partial<Anomaly> = {}): Anomaly => ({
  deviceId,
  metric: 'temperature_c',
  value: 29.2,
  startAt,
  duration: 60,
  ...change,
});

/** Three server rooms, started 2 s apart, as the form makes them. */
const staggered = () => [anomaly('d001', 20), anomaly('d002', 22), anomaly('d003', 24)];

function setup(fleet = labFleet(6)) {
  const sim = fakeLabSimulator(fleet);
  vi.stubGlobal('fetch', sim.fetch);
  const store = createStudioStore();
  store.getState().setView(structuredClone(fleet), 1);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store}>{children}</StudioProvider>
  );
  const hook = renderHook(() => useInjection(), { wrapper });
  return { sim, store, hook };
}

describe('useInjection: inject now', () => {
  it('reads the engine clock first, then sends one anomaly at a time with absolute start times', async () => {
    const { sim, hook } = setup();
    await act(async () => {
      expect(await hook.result.current.injectNow(staggered())).toBe(true);
    });

    const order = sim.calls.map((call) => `${call.method} ${call.path}`);
    expect(order).toEqual([
      'GET /api/state',
      'POST /api/anomalies',
      'POST /api/anomalies',
      'POST /api/anomalies',
    ]);
    // The fixture's engine clock is at 10 s: 20, 22 and 24 s from now are 30, 32 and 34 s on it (decision D1).
    expect(
      sim.callsTo('POST', '/api/anomalies').map((c) => (c.body as { startAt: number }).startAt),
    ).toEqual([30, 32, 34]);
    expect(sim.callsTo('POST', '/api/anomalies')[0]!.body).toMatchObject({
      deviceId: 'd001',
      metric: 'temperature_c',
      value: 29.2,
      duration: 60,
    });
  });

  it('puts every answer in the store, says what it did, and records the command for the log', async () => {
    const { store, hook } = setup();
    await act(async () => {
      await hook.result.current.injectNow(staggered());
    });

    expect(store.getState().view?.engine.anomalies).toHaveLength(3);
    expect(hook.result.current.notice).toEqual({ tone: 'ok', text: 'Injected 3 faults.' });
    expect(hook.result.current.progress.results.every((r) => r.ok)).toBe(true);
    const [command] = hook.result.current.commands;
    expect(command).toMatchObject({
      kind: 'inject',
      text: 'Injected a breach on 3 devices: temperature_c → 29.2',
      devices: ['d001', 'd002', 'd003'],
    });
    expect(hook.result.current.injectedBaseS).toBeNull();
  });

  it('sends nothing for no anomalies', async () => {
    const { sim, hook } = setup();
    await act(async () => {
      expect(await hook.result.current.injectNow([])).toBe(false);
    });
    expect(sim.calls).toEqual([]);
  });

  it('refuses, naming the device, a fault that would play over one on the engine, and sends nothing', async () => {
    const fleet = labFleet(6);
    // 10 s on the clock; an anomaly from 5 s to 65 s is playing on d002.
    fleet.engine.anomalies = [
      {
        id: 'a1',
        anomaly: { deviceId: 'd002', metric: 'temperature_c', value: 29, startAt: 5, duration: 60 },
      },
    ];
    const { sim, hook } = setup(fleet);
    await act(async () => {
      expect(await hook.result.current.injectNow(staggered())).toBe(false);
    });

    expect(sim.callsTo('POST', '/api/anomalies')).toEqual([]);
    expect(hook.result.current.notice?.tone).toBe('bad');
    expect(hook.result.current.notice?.text).toMatch(
      /^Nothing was sent: d002 already has a fault on temperature_c/,
    );
    expect(hook.result.current.commands).toEqual([]);
  });

  it('does not send when the engine clock cannot be read', async () => {
    const { sim, hook } = setup();
    sim.failState({ status: 502, message: 'engine down' });
    await act(async () => {
      expect(await hook.result.current.injectNow(staggered())).toBe(false);
    });
    expect(sim.callsTo('POST', '/api/anomalies')).toEqual([]);
    expect(hook.result.current.notice?.text).toBe(
      "The engine's clock could not be read: engine down",
    );
  });

  it('goes on after one is refused, says how many arrived, and keeps their ids to take out again', async () => {
    const { sim, store, hook } = setup();
    sim.failAdd((_, index) =>
      index === 1 ? { status: 400, message: 'Device "d002" has no metric' } : null,
    );
    await act(async () => {
      expect(await hook.result.current.injectNow(staggered())).toBe(false);
    });

    expect(sim.callsTo('POST', '/api/anomalies')).toHaveLength(3);
    expect(hook.result.current.notice?.text).toBe('2 of 3 injected. Device "d002" has no metric');
    expect(hook.result.current.partial).toEqual({ ids: ['x1', 'x2'], ok: 2, total: 3 });
    expect(hook.result.current.commands[0]!.devices).toEqual(['d001', 'd003']);

    sim.failAdd(null);
    await act(async () => {
      expect(await hook.result.current.remove(hook.result.current.partial!.ids)).toBe(true);
    });
    expect(store.getState().view?.engine.anomalies).toEqual([]);
    expect(hook.result.current.partial).toBeNull();
    expect(hook.result.current.notice).toEqual({ tone: 'ok', text: 'Removed 2 faults.' });
  });
});

describe('useInjection: inject timeline', () => {
  it('sends the whole draft and remembers the engine clock it was injected at', async () => {
    const { hook } = setup();
    await act(async () => {
      expect(await hook.result.current.injectTimeline(staggered())).toBe(true);
    });
    expect(hook.result.current.injectedBaseS).toBe(10);
    expect(hook.result.current.commands[0]).toMatchObject({
      kind: 'timeline',
      text: 'Injected a timeline of 3 faults',
    });
  });
});

describe('useInjection: remove', () => {
  it('takes faults out, one at a time, and records it', async () => {
    const fleet = labFleet(6);
    const { sim, store, hook } = setup(fleet);
    await act(async () => {
      await hook.result.current.injectNow(staggered());
    });
    const ids = store.getState().view!.engine.anomalies.map((a) => a.id);
    await act(async () => {
      await hook.result.current.remove(ids);
    });

    expect(sim.callsTo('DELETE', '/api/anomalies/x1')).toHaveLength(1);
    expect(store.getState().view?.engine.anomalies).toEqual([]);
    expect(hook.result.current.commands.at(-1)).toMatchObject({
      kind: 'remove',
      text: 'Removed 3 faults',
    });
  });

  it('counts a fault that is gone already as taken out', async () => {
    const { store, hook } = setup();
    await act(async () => {
      expect(await hook.result.current.remove(['nope'])).toBe(true);
    });
    expect(hook.result.current.notice).toEqual({ tone: 'ok', text: 'Removed 1 fault.' });
    expect(store.getState().view).not.toBeNull();
  });

  it('does nothing for no ids', async () => {
    const { sim, hook } = setup();
    await act(async () => {
      expect(await hook.result.current.remove([])).toBe(false);
    });
    expect(sim.calls).toEqual([]);
  });
});

describe('useInjection: progress', () => {
  it('reports a run while it goes, and leaves its results to be read', async () => {
    const { hook } = setup();
    expect(hook.result.current.progress.running).toBe(false);
    await act(async () => {
      await hook.result.current.injectNow(staggered());
    });
    await waitFor(() => expect(hook.result.current.progress.running).toBe(false));
    expect(hook.result.current.progress).toMatchObject({ label: 'Injecting', done: 3, total: 3 });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { Snapshot, StateView } from '../api/types';
import { createStudioStore } from './store';
import { connectStream, type EventSourceLike } from './stream';

const view = fixture;
const T0 = Date.parse('2026-10-20T09:14:30.000Z');

class FakeSource implements EventSourceLike {
  closed = false;
  private readonly listeners = new Map<string, ((event: Event) => void)[]>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  /** What the browser does: an event with `data` for a message, a plain event for open and error. */
  emit(type: string, data?: unknown): void {
    const event = (
      data === undefined
        ? new Event(type)
        : new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data) })
    ) as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function setup(options: { getState?: () => Promise<StateView> } = {}) {
  const store = createStudioStore();
  const source = new FakeSource();
  const getState = options.getState ?? vi.fn(async () => ({ ...view, observationCursor: 99 }));
  const connection = connectStream(store, { createSource: () => source, getState });
  return { store, source, getState, connection };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the link', () => {
  it('is connecting, goes live when the stream opens, and is lost when it fails', () => {
    const { store, source } = setup();
    expect(store.getState().link).toBe('connecting');

    source.emit('open');
    expect(store.getState().link).toBe('live');

    vi.setSystemTime(T0 + 5000);
    source.emit('error');
    expect(store.getState().link).toBe('lost');
    expect(store.getState().lostSince).toBe(T0 + 5000);
  });

  it('comes back live after a reconnect, with the new snapshot', () => {
    const { store, source } = setup();
    source.emit('open');
    source.emit('snapshot', { ...view, publishLog: [] } satisfies Snapshot);
    source.emit('error');
    source.emit('open');
    source.emit('snapshot', { ...view, observationCursor: 7, publishLog: [] });
    expect(store.getState().link).toBe('live');
    expect(store.getState().lostSince).toBeNull();
    expect(store.getState().view?.observationCursor).toBe(7);
  });
});

describe('the events that carry state', () => {
  it('takes the snapshot as the view and notes when it arrived', () => {
    const { store, source } = setup();
    vi.setSystemTime(T0 + 1000);
    source.emit('snapshot', { ...view, publishLog: [] });
    expect(store.getState().view).toEqual(view);
    expect(store.getState().lastDataAt).toBe(T0 + 1000);
  });

  it('replaces a slice for ingest, alerts, metrics and broker', () => {
    const { store, source } = setup();
    source.emit('snapshot', { ...view, publishLog: [] });

    source.emit('ingest', { ...view.ingest, status: 'unreachable', alertSink: null });
    source.emit('alerts', { alerts: [], lastOkAt: null, stale: true });
    source.emit('metrics', { samples: [], lastOkAt: null, stale: true });
    source.emit('broker', { url: 'mqtt://localhost:1883', port: 1883, connected: false });

    const state = store.getState().view;
    expect(state?.ingest.status).toBe('unreachable');
    expect(state?.alerts.stale).toBe(true);
    expect(state?.metrics.samples).toEqual([]);
    expect(state?.broker.connected).toBe(false);
    expect(state?.engine).toEqual(view.engine);
  });

  it('ignores a message that is not JSON, and an event it does not use', () => {
    const { store, source } = setup();
    source.emit('snapshot', { ...view, publishLog: [] });
    source.emit('ingest', 'not json {');
    source.emit('ingest', '"just a string"');
    source.emit('tick-error', { message: 'boom' });
    source.emit('observation', { id: 1 });
    expect(store.getState().view).toEqual(view);
  });
});

describe('a change made by an operator', () => {
  it('reads the state again once for a burst of state events, after the last one', async () => {
    const { store, source, getState } = setup();
    source.emit('snapshot', { ...view, publishLog: [] });

    source.emit('state', { type: 'device-state' });
    await vi.advanceTimersByTimeAsync(100);
    source.emit('state', { type: 'reset' });
    await vi.advanceTimersByTimeAsync(100);
    source.emit('state', { type: 'anomaly-added' });
    expect(getState).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    expect(getState).toHaveBeenCalledTimes(1);
    expect(store.getState().view?.observationCursor).toBe(99);
  });

  it('goes on when the read fails', async () => {
    const { store, source } = setup({
      getState: vi.fn(async () => Promise.reject(new Error('down'))),
    });
    source.emit('snapshot', { ...view, publishLog: [] });
    source.emit('state', { type: 'reset' });
    await vi.advanceTimersByTimeAsync(400);
    expect(store.getState().view).toEqual(view);
  });
});

describe('the publish rate', () => {
  it('is counted from the published events and written about once a second', async () => {
    const { store, source } = setup();
    for (let i = 0; i < 15; i++) source.emit('published', { seq: i });
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().publishRate).toBe(15);
  });

  it('falls back to zero when the messages stop', async () => {
    const { store, source } = setup();
    for (let i = 0; i < 10; i++) source.emit('published', { seq: i });
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().publishRate).toBe(10);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.getState().publishRate).toBe(0);
  });
});

describe('close', () => {
  it('closes the source, cancels a pending refetch and stops the timers', async () => {
    const { store, source, getState, connection } = setup();
    source.emit('snapshot', { ...view, publishLog: [] });
    source.emit('state', { type: 'reset' });
    source.emit('published', { seq: 1 });

    connection.close();
    await vi.advanceTimersByTimeAsync(5000);

    expect(source.closed).toBe(true);
    expect(getState).not.toHaveBeenCalled();
    expect(store.getState().publishRate).toBe(0);
  });

  it('does not write a read that finished after it was closed', async () => {
    let finish: (view: StateView) => void = () => {};
    const getState = vi.fn(() => new Promise<StateView>((resolve) => (finish = resolve)));
    const { store, source, connection } = setup({ getState });
    source.emit('snapshot', { ...view, publishLog: [] });
    source.emit('state', { type: 'reset' });
    await vi.advanceTimersByTimeAsync(300);
    expect(getState).toHaveBeenCalledTimes(1);

    connection.close();
    finish({ ...view, observationCursor: 123 });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().view?.observationCursor).toBe(view.observationCursor);
  });
});

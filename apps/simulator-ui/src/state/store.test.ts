import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { Snapshot, StateView } from '../api/types';
import { createStudioStore } from './store';

const view = fixture;
const snapshot: Snapshot = {
  ...view,
  publishLog: [
    { deviceId: 'dc-env-01', topic: 't', payload: '{}', seq: 1, ts: '2026-10-20T09:14:30.000Z' },
  ],
};
const down = {
  ...view.ingest,
  status: 'unreachable' as const,
  alertSink: null,
  database: null,
  broker: null,
};

describe('createStudioStore', () => {
  it('starts connecting, with no data, the palette closed and the rail unpinned', () => {
    const state = createStudioStore().getState();
    expect(state.link).toBe('connecting');
    expect(state.view).toBeNull();
    expect(state.lastDataAt).toBeNull();
    expect(state.lostSince).toBeNull();
    expect(state.railPinned).toBe(false);
    expect(state.paletteOpen).toBe(false);
    expect(state.publishRate).toBe(0);
  });

  it('can start with the rail pinned', () => {
    expect(createStudioStore({ railPinned: true }).getState().railPinned).toBe(true);
  });

  it('keeps stores apart', () => {
    const a = createStudioStore();
    const b = createStudioStore();
    a.getState().setPaletteOpen(true);
    expect(b.getState().paletteOpen).toBe(false);
  });
});

describe('the state the simulator sends', () => {
  it('takes a snapshot as the view, without its publish log, and notes when', () => {
    const store = createStudioStore();
    store.getState().applySnapshot(snapshot, 1000);
    const state = store.getState();
    expect(state.view).toEqual(view);
    expect(state.view).not.toHaveProperty('publishLog');
    expect(state.lastDataAt).toBe(1000);
  });

  it('replaces a slice, and leaves the others alone', () => {
    const store = createStudioStore();
    store.getState().applySnapshot(snapshot, 1000);
    store
      .getState()
      .patchSlice('broker', { url: 'mqtt://localhost:1883', port: 1883, connected: false }, 2000);
    const state = store.getState();
    expect(state.view?.broker.connected).toBe(false);
    expect(state.view?.ingest).toEqual(view.ingest);
    expect(state.view?.engine).toEqual(view.engine);
    expect(state.lastDataAt).toBe(2000);
  });

  it('ignores a slice that arrives before the first snapshot', () => {
    const store = createStudioStore();
    store.getState().patchSlice('ingest', down, 1000);
    expect(store.getState().view).toBeNull();
    expect(store.getState().lastDataAt).toBeNull();
  });

  it('takes a refetched view in place of the old one', () => {
    const store = createStudioStore();
    store.getState().applySnapshot(snapshot, 1000);
    const next: StateView = { ...view, observationCursor: 42 };
    store.getState().setView(next, 3000);
    expect(store.getState().view?.observationCursor).toBe(42);
    expect(store.getState().lastDataAt).toBe(3000);
  });
});

describe('the last known alert sink', () => {
  it('is remembered, and survives ingest becoming unreachable', () => {
    const store = createStudioStore();
    expect(store.getState().lastAlertSink).toBeNull();
    store.getState().applySnapshot(snapshot, 1000);
    expect(store.getState().lastAlertSink).toBe('ops-command-center');

    store.getState().patchSlice('ingest', down, 2000);
    expect(store.getState().view?.ingest.alertSink).toBeNull();
    expect(store.getState().lastAlertSink).toBe('ops-command-center');
  });

  it('follows ingest when it answers with another sink', () => {
    const store = createStudioStore();
    store.getState().applySnapshot(snapshot, 1000);
    store.getState().patchSlice('ingest', { ...view.ingest, alertSink: 'none' }, 2000);
    expect(store.getState().lastAlertSink).toBe('none');
  });
});

describe('the link', () => {
  it('goes live, is lost, and notes when it was lost only once', () => {
    const store = createStudioStore();
    store.getState().setLink('live', 100);
    expect(store.getState().lostSince).toBeNull();

    store.getState().setLink('lost', 200);
    store.getState().setLink('lost', 300);
    expect(store.getState().link).toBe('lost');
    expect(store.getState().lostSince).toBe(200);

    store.getState().setLink('live', 400);
    expect(store.getState().lostSince).toBeNull();
  });

  it('keeps the last view while the link is lost', () => {
    const store = createStudioStore();
    store.getState().applySnapshot(snapshot, 1000);
    store.getState().setLink('lost', 2000);
    expect(store.getState().view).toEqual(view);
    expect(store.getState().lastDataAt).toBe(1000);
  });
});

describe('the interface state', () => {
  it('holds the publish rate, the rail pin and the palette', () => {
    const store = createStudioStore();
    store.getState().setPublishRate(12.5);
    store.getState().setRailPinned(true);
    store.getState().setPaletteOpen(true);
    const state = store.getState();
    expect([state.publishRate, state.railPinned, state.paletteOpen]).toEqual([12.5, true, true]);
  });
});

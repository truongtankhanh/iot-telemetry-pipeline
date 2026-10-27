import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { benchmarkFixture } from '../api/fixtures/benchmarkFixtures';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type {
  BenchmarkDetail,
  BenchmarkRunDetail,
  BenchmarkRunSummary,
  BenchmarkSummary,
  MetricsFeed,
  ObservationEvent,
  ObservationsPage,
  PublishedMessage,
  SamplingReport,
  Snapshot,
  StateView,
} from '../api/types';
import { BenchmarkStore } from './benchmarkStore';
import { HistoryStore } from './history';
import { MessageLog } from './messageLog';
import { ObservationLog } from './observationLog';
import { PulseBus } from './pulses';
import { SessionMetricsStore } from './sessionMetricsStore';
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

function setup(
  options: {
    getState?: () => Promise<StateView>;
    history?: HistoryStore;
    pulses?: PulseBus;
    observations?: ObservationLog;
    messages?: MessageLog;
    getObservations?: (
      request: { before?: number; limit?: number },
      options: { signal?: AbortSignal },
    ) => Promise<ObservationsPage>;
    benchmark?: BenchmarkStore;
    getBenchmark?: (options: { signal?: AbortSignal }) => Promise<BenchmarkDetail>;
    sessionMetrics?: SessionMetricsStore;
  } = {},
) {
  const store = createStudioStore();
  const source = new FakeSource();
  const getState = options.getState ?? vi.fn(async () => ({ ...view, observationCursor: 99 }));
  const connection = connectStream(store, {
    createSource: () => source,
    getState,
    ...(options.history ? { history: options.history } : {}),
    ...(options.pulses ? { pulses: options.pulses } : {}),
    ...(options.observations ? { observations: options.observations } : {}),
    ...(options.messages ? { messages: options.messages } : {}),
    ...(options.getObservations ? { getObservations: options.getObservations } : {}),
    ...(options.benchmark ? { benchmark: options.benchmark } : {}),
    ...(options.getBenchmark ? { getBenchmark: options.getBenchmark } : {}),
    ...(options.sessionMetrics ? { sessionMetrics: options.sessionMetrics } : {}),
  });
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

describe('the history', () => {
  const published = (deviceId: string, atMs: number, value: number): PublishedMessage => {
    const ts = new Date(atMs).toISOString();
    return {
      deviceId,
      topic: `campus/BLD-DC/${deviceId}/telemetry`,
      payload: JSON.stringify({ seq: 1, ts, metrics: { temperature_c: value } }),
      seq: 1,
      ts,
    };
  };

  it('is seeded from the publish log of a snapshot', () => {
    const history = new HistoryStore();
    const { source } = setup({ history });
    source.emit('snapshot', {
      ...view,
      publishLog: [
        published('dc-env-01', T0 - 4000, 22.4),
        published('dc-env-01', T0 - 2000, 22.6),
      ],
    });
    expect(history.series('dc-env-01', 'temperature_c').map((s) => s.v)).toEqual([22.4, 22.6]);
  });

  it('records each published message', () => {
    const history = new HistoryStore();
    const { source } = setup({ history });
    source.emit('snapshot', { ...view, publishLog: [] });
    source.emit('published', published('dc-env-01', T0, 29.3));
    expect(history.series('dc-env-01', 'temperature_c')).toEqual([{ t: T0, v: 29.3 }]);
    expect(history.lastSeen('dc-env-01')).toBe(T0);
  });

  it('is seeded again by the snapshot of a reconnect, not doubled', () => {
    const history = new HistoryStore();
    const { source } = setup({ history });
    const log = [published('dc-env-01', T0 - 2000, 22.6)];
    source.emit('snapshot', { ...view, publishLog: log });
    source.emit('published', published('dc-env-01', T0, 22.8));
    source.emit('snapshot', { ...view, publishLog: [...log, published('dc-env-01', T0, 22.8)] });
    expect(history.series('dc-env-01', 'temperature_c').map((s) => s.v)).toEqual([22.6, 22.8]);
  });

  it('copes with a snapshot that has no publish log, and with a published message that is not a message', () => {
    const history = new HistoryStore();
    const { source } = setup({ history });
    source.emit('snapshot', view); // the fixture is a state view: it has no publishLog
    source.emit('published', 'not json');
    source.emit('published', { seq: 3 });
    expect(history.series('dc-env-01', 'temperature_c')).toEqual([]);
    expect(history.lastSeen('dc-env-01')).toBeNull();
  });

  it('still counts a published message for the rate when there is no history', async () => {
    const { store, source } = setup();
    source.emit('snapshot', { ...view, publishLog: [] });
    for (let i = 0; i < 5; i++) source.emit('published', published('dc-env-01', T0 + i, 1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().publishRate).toBe(5);
  });
});

describe('the pulses', () => {
  const published = (deviceId: string, atMs: number): PublishedMessage => {
    const ts = new Date(atMs).toISOString();
    return {
      deviceId,
      topic: `campus/BLD-DC/${deviceId}/telemetry`,
      payload: JSON.stringify({ seq: 1, ts, metrics: { temperature_c: 22.4 } }),
      seq: 1,
      ts,
    };
  };

  it('tells the bus which device published, when the message arrived', () => {
    const pulses = new PulseBus();
    const heard: [string, number][] = [];
    pulses.subscribe(['dc-env-01', 'dc-env-02'], (deviceId, at) => heard.push([deviceId, at]));
    const { source } = setup({ pulses });
    source.emit('snapshot', { ...view, publishLog: [] });

    vi.setSystemTime(T0 + 1000);
    source.emit('published', published('dc-env-01', T0));
    vi.setSystemTime(T0 + 2500);
    source.emit('published', published('dc-env-02', T0 + 2000));
    expect(heard).toEqual([
      ['dc-env-01', T0 + 1000],
      ['dc-env-02', T0 + 2500],
    ]);
  });

  it('does not replay the publish log of a snapshot as pulses: it is the past', () => {
    const pulses = new PulseBus();
    const heard: string[] = [];
    pulses.subscribe(['dc-env-01'], (deviceId) => heard.push(deviceId));
    const { source } = setup({ pulses });
    source.emit('snapshot', {
      ...view,
      publishLog: [published('dc-env-01', T0 - 4000), published('dc-env-01', T0 - 2000)],
    });
    expect(heard).toEqual([]);
  });

  it('feeds the history and the bus from the same message', () => {
    const history = new HistoryStore();
    const pulses = new PulseBus();
    const heard: string[] = [];
    pulses.subscribe(['dc-env-01'], (deviceId) => heard.push(deviceId));
    const { source } = setup({ history, pulses });
    source.emit('snapshot', { ...view, publishLog: [] });
    source.emit('published', published('dc-env-01', T0));
    expect(heard).toEqual(['dc-env-01']);
    expect(history.lastSeen('dc-env-01')).toBe(T0);
  });

  it('ignores a message that is not JSON, and one that names no device', () => {
    const pulses = new PulseBus();
    const heard: string[] = [];
    pulses.subscribe(['dc-env-01'], (deviceId) => heard.push(deviceId));
    const { source } = setup({ pulses });
    source.emit('published', 'not json');
    source.emit('published', { seq: 3 });
    source.emit('published', { deviceId: 7 });
    expect(heard).toEqual([]);
  });

  it('works without a bus: the rate and the history do not need one', async () => {
    const { store, source } = setup();
    source.emit('snapshot', { ...view, publishLog: [] });
    for (let i = 0; i < 3; i++) source.emit('published', published('dc-env-01', T0 + i));
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().publishRate).toBe(3);
  });
});

describe('the observation log', () => {
  const event = (id: number): ObservationEvent => ({
    id,
    at: new Date(T0 + id * 1000).toISOString(),
    kind: 'engine-state',
    data: { n: id },
  });
  const snapshotAt = (cursor: number): Snapshot => ({
    ...view,
    observationCursor: cursor,
    publishLog: [],
  });
  /** Pages of 2 events, newest first, over ids 1 to `newest`; `next` is the id of the oldest event on the page. */
  const pagesOf = (newest: number) =>
    vi.fn(async ({ before }: { before?: number; limit?: number }) => {
      const top = before === undefined ? newest : before - 1;
      const events = [top, top - 1].filter((id) => id >= 1).map(event);
      const last = events.at(-1)?.id ?? 0;
      return { events, next: last > 1 ? last : null } satisfies ObservationsPage;
    });
  const ids = (log: ObservationLog) => log.snapshot().events.map((e) => e.id);
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('records each observation event', () => {
    const observations = new ObservationLog();
    const { source } = setup({ observations });
    source.emit('observation', event(1));
    source.emit('observation', event(2));
    vi.advanceTimersByTime(1000);
    expect(ids(observations)).toEqual([2, 1]);
  });

  it('ignores an observation that has no id, and one that is not JSON', () => {
    const observations = new ObservationLog();
    const { source } = setup({ observations });
    source.emit('observation', { kind: 'engine-state', data: {}, at: 'x' });
    source.emit('observation', 'not json');
    vi.advanceTimersByTime(1000);
    expect(ids(observations)).toEqual([]);
  });

  it('reads the log to its end when a snapshot shows it is behind, then holds what it read', async () => {
    const observations = new ObservationLog();
    const getObservations = pagesOf(5);
    const { source } = setup({ observations, getObservations });
    source.emit('snapshot', snapshotAt(5));
    expect(observations.snapshot().loading).toBe(0);

    await settle();
    expect(ids(observations)).toEqual([5, 4, 3, 2, 1]);
    expect(observations.snapshot().loading).toBeNull();
    const calls = getObservations.mock.calls.map(([request]) => request);
    expect(calls).toEqual([{ limit: 500 }, { limit: 500, before: 4 }, { limit: 500, before: 2 }]);
  });

  it('reads nothing when the log already has the newest event', async () => {
    const observations = new ObservationLog();
    observations.seed([event(5), event(4)]);
    const getObservations = pagesOf(5);
    const { source } = setup({ observations, getObservations });
    source.emit('snapshot', snapshotAt(5));
    await settle();
    expect(getObservations).not.toHaveBeenCalled();
    expect(observations.snapshot().loading).toBeNull();
  });

  it('reads nothing for a simulator that has no observation yet', async () => {
    const observations = new ObservationLog();
    const getObservations = pagesOf(0);
    const { source } = setup({ observations, getObservations });
    source.emit('snapshot', snapshotAt(0));
    await settle();
    expect(getObservations).not.toHaveBeenCalled();
  });

  it('reads what a dropped link missed, and keeps what it had', async () => {
    const observations = new ObservationLog();
    observations.seed([event(2), event(1)]);
    const { source } = setup({ observations, getObservations: pagesOf(4) });
    source.emit('snapshot', snapshotAt(4));
    await settle();
    expect(ids(observations)).toEqual([4, 3, 2, 1]);
  });

  it('forgets the log first when the simulator started again and its ids began at 1', async () => {
    const observations = new ObservationLog();
    observations.seed([event(40), event(39)]);
    const { source } = setup({ observations, getObservations: pagesOf(2) });
    source.emit('snapshot', snapshotAt(2));
    await settle();
    expect(ids(observations)).toEqual([2, 1]);
  });

  it('keeps an event that arrived live while the read was on its way', async () => {
    const observations = new ObservationLog();
    const { source } = setup({ observations, getObservations: pagesOf(5) });
    source.emit('snapshot', snapshotAt(5));
    source.emit('observation', event(6));
    await settle();
    expect(ids(observations)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('stops at the 5,000 events the simulator keeps, however long it says the log is', async () => {
    const observations = new ObservationLog();
    // Pages of 500 that never end: the cursor always points at one more.
    let pageNo = 0;
    const getObservations = vi.fn(async (_request: unknown, _options: unknown) => {
      const top = 9000 - pageNo * 500;
      pageNo += 1;
      const events = Array.from({ length: 500 }, (_, i) => event(top - i));
      return { events, next: top - 499 } satisfies ObservationsPage;
    });
    const { source } = setup({ observations, getObservations });
    source.emit('snapshot', snapshotAt(9000));
    await settle();
    expect(getObservations).toHaveBeenCalledTimes(10);
    expect(ids(observations)).toHaveLength(5000);
    expect(ids(observations)[0]).toBe(9000);
  });

  it('leaves the log as it is when a read fails, and reads again at the next snapshot', async () => {
    const observations = new ObservationLog();
    observations.seed([event(2)]);
    const getObservations = vi
      .fn()
      .mockRejectedValueOnce(new Error('Cannot reach the simulator'))
      .mockImplementation(pagesOf(4));
    const { source } = setup({ observations, getObservations });
    source.emit('snapshot', snapshotAt(4));
    await settle();
    expect(ids(observations)).toEqual([2]);
    expect(observations.snapshot().loading).toBeNull();

    source.emit('snapshot', snapshotAt(4));
    await settle();
    expect(ids(observations)).toEqual([4, 3, 2, 1]);
  });

  it('cancels the read going on when a newer snapshot arrives, and only the newer one writes', async () => {
    const observations = new ObservationLog();
    const signals: AbortSignal[] = [];
    const release: (() => void)[] = [];
    const getObservations = vi.fn(
      (_request: unknown, options: { signal?: AbortSignal }) =>
        new Promise<ObservationsPage>((resolve) => {
          if (options.signal) signals.push(options.signal);
          release.push(() => resolve({ events: [event(signals.length)], next: null }));
        }),
    );
    const { source } = setup({ observations, getObservations });
    source.emit('snapshot', snapshotAt(3));
    source.emit('snapshot', snapshotAt(3));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    release[0]?.();
    release[1]?.();
    await settle();
    expect(ids(observations)).toEqual([2]);
    expect(observations.snapshot().loading).toBeNull();
  });

  it('cancels a read that is up to date at the second snapshot, without leaving the log loading', async () => {
    const observations = new ObservationLog();
    const release: (() => void)[] = [];
    const getObservations = vi.fn(
      () =>
        new Promise<ObservationsPage>((resolve) => {
          release.push(() => resolve({ events: [event(1)], next: null }));
        }),
    );
    const { source } = setup({ observations, getObservations });
    source.emit('snapshot', snapshotAt(1));
    observations.seed([event(1)]); // the event arrived live
    source.emit('snapshot', snapshotAt(1));
    expect(observations.snapshot().loading).toBeNull();
    release[0]?.();
    await settle();
    expect(observations.snapshot().loading).toBeNull();
  });

  it('does not write a read that finished after it was closed', async () => {
    const observations = new ObservationLog();
    const release: (() => void)[] = [];
    const getObservations = vi.fn(
      () =>
        new Promise<ObservationsPage>((resolve) => {
          release.push(() => resolve({ events: [event(1)], next: null }));
        }),
    );
    const { source, connection } = setup({ observations, getObservations });
    source.emit('snapshot', snapshotAt(1));
    connection.close();
    release[0]?.();
    await settle();
    expect(ids(observations)).toEqual([]);
    expect(observations.snapshot().loading).toBeNull();
  });

  it('works without a log: a snapshot reads nothing and an observation is ignored', async () => {
    const getObservations = pagesOf(5);
    const { source } = setup({ getObservations });
    source.emit('snapshot', snapshotAt(5));
    source.emit('observation', event(1));
    await settle();
    expect(getObservations).not.toHaveBeenCalled();
  });
});

describe('a burst of published messages (SIM-12)', () => {
  const burstMessage = (i: number): PublishedMessage => {
    const ts = new Date(T0 + i).toISOString();
    return {
      deviceId: 'dc-env-01',
      topic: 'campus/BLD-DC/dc-env-01/telemetry',
      payload: JSON.stringify({ seq: i + 2, ts, metrics: { temperature_c: i } }),
      seq: i + 2,
      ts,
      fault: 'burst',
    };
  };

  it('leaves the history within its bound, tells the pulses of every message, counts them in the rate and does not touch the store', async () => {
    const history = new HistoryStore({ maxPoints: 50 });
    const pulses = new PulseBus();
    const heard: string[] = [];
    pulses.subscribe(['dc-env-01'], (deviceId) => heard.push(deviceId));
    const { store, source } = setup({ history, pulses });
    source.emit('snapshot', { ...view, publishLog: [] } satisfies Snapshot);
    const before = store.getState().view;

    for (let i = 0; i < 1000; i++) source.emit('published', burstMessage(i));
    await vi.advanceTimersByTimeAsync(1000);

    const series = history.series('dc-env-01', 'temperature_c');
    // The history keeps its newest points, however many arrive at once.
    expect(series.length).toBeLessThanOrEqual(50);
    expect(series.at(-1)?.v).toBe(999);
    expect(heard).toHaveLength(1000);
    expect(store.getState().publishRate).toBe(1000);
    // A message is not a change of the state: nothing is stored per message, and nothing is read again.
    expect(store.getState().view).toBe(before);
  });

  it('ignores a message of the burst that is not one, and goes on', async () => {
    const history = new HistoryStore({ maxPoints: 50 });
    const { source } = setup({ history });
    source.emit('snapshot', { ...view, publishLog: [] } satisfies Snapshot);
    source.emit('published', 'not json');
    for (let i = 0; i < 10; i++) source.emit('published', burstMessage(i));
    await vi.advanceTimersByTimeAsync(1000);
    expect(history.series('dc-env-01', 'temperature_c')).toHaveLength(10);
  });
});

describe('the message log and the sampling of the simulator (SIM-13)', () => {
  const published = (id: number, overrides: Partial<PublishedMessage> = {}): PublishedMessage => {
    const ts = new Date(T0 + id).toISOString();
    return {
      id,
      at: ts,
      ackMs: 3,
      deviceId: 'dc-env-01',
      topic: 'campus/BLD-DC/dc-env-01/telemetry',
      payload: JSON.stringify({ seq: id, ts, metrics: { temperature_c: id } }),
      seq: id,
      ts,
      ...overrides,
    };
  };
  const report = (overrides: Partial<SamplingReport> = {}): SamplingReport => ({
    total: 100,
    skipped: 95,
    forwarded: 5,
    windowMs: 1000,
    budgetPerS: 250,
    active: true,
    ...overrides,
  });
  const ids = (messages: MessageLog) => messages.snapshot().rows.map((row) => row.id);

  it('is seeded from a snapshot: the publish log, the simulator’s total and its sampling notice', () => {
    const messages = new MessageLog();
    const { source } = setup({ messages });
    source.emit('snapshot', {
      ...view,
      publishLog: [published(1), published(2)],
      publishTotal: 7612,
      sampling: { active: true, skipped: 40, budgetPerS: 250, windowMs: 1000 },
    } satisfies Snapshot);
    expect(ids(messages)).toEqual([2, 1]);
    expect(messages.snapshot().total).toBe(7612);
    expect(messages.snapshot().sampling).toEqual({ skipped: 40, budgetPerS: 250, windowMs: 1000 });
  });

  it('is seeded again by the snapshot of a reconnect, not doubled', () => {
    const messages = new MessageLog();
    const { source } = setup({ messages });
    source.emit('snapshot', { ...view, publishLog: [published(1)], publishTotal: 1 });
    source.emit('published', published(2));
    source.emit('snapshot', { ...view, publishLog: [published(1), published(2)], publishTotal: 2 });
    expect(ids(messages)).toEqual([2, 1]);
    expect(messages.snapshot().total).toBe(2);
  });

  it('records each published message and counts it', () => {
    const messages = new MessageLog();
    const { source } = setup({ messages });
    source.emit('snapshot', { ...view, publishLog: [], publishTotal: 10 });
    source.emit('published', published(11));
    source.emit('published', published(12));
    vi.advanceTimersByTime(250);
    expect(ids(messages)).toEqual([12, 11]);
    expect(messages.snapshot().total).toBe(12);
  });

  it('copes with a snapshot that has no publish log or total, and with a published event that is not a message', () => {
    const messages = new MessageLog();
    const { source } = setup({ messages });
    source.emit('snapshot', view);
    source.emit('published', 'not json');
    source.emit('published', { seq: 3 }); // no id: it cannot be kept
    vi.advanceTimersByTime(250);
    expect(ids(messages)).toEqual([]);
    expect(messages.snapshot().total).toBe(0);
  });

  it('keeps the publish log, the total and the sampling notice out of the view in the store', () => {
    const { store, source } = setup({ messages: new MessageLog() });
    source.emit('snapshot', {
      ...view,
      publishLog: [published(1)],
      publishTotal: 5,
      sampling: { active: false, skipped: 0, budgetPerS: 250, windowMs: 1000 },
    });
    const stored = store.getState().view as unknown as Record<string, unknown>;
    expect(stored).not.toHaveProperty('publishLog');
    expect(stored).not.toHaveProperty('publishTotal');
    expect(stored).not.toHaveProperty('sampling');
    expect(stored).toHaveProperty('engine');
  });

  it('adds the skipped messages of a report to the rate, and sets the total and the notice', async () => {
    const messages = new MessageLog();
    const { store, source } = setup({ messages });
    source.emit('snapshot', { ...view, publishLog: [], publishTotal: 0 });
    for (let id = 1; id <= 5; id++) source.emit('published', published(id));
    source.emit('sampling', report());
    await vi.advanceTimersByTimeAsync(1000);

    // 5 events received and 95 skipped: the rate of the messages is 100 a second, not 5.
    expect(store.getState().publishRate).toBe(100);
    expect(messages.snapshot().total).toBe(100);
    expect(messages.snapshot().sampling).toEqual({ skipped: 95, budgetPerS: 250, windowMs: 1000 });
  });

  it('ends the notice with the closing report and adds nothing to the rate for it', async () => {
    const messages = new MessageLog();
    const { store, source } = setup({ messages });
    source.emit('snapshot', { ...view, publishLog: [] });
    source.emit('sampling', report());
    source.emit('sampling', report({ total: 120, skipped: 0, active: false }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(messages.snapshot().sampling).toBeNull();
    expect(messages.snapshot().total).toBe(120);
    expect(store.getState().publishRate).toBe(95);
  });

  it('ignores a sampling event that is not a report', async () => {
    const messages = new MessageLog();
    const { store, source } = setup({ messages });
    source.emit('snapshot', { ...view, publishLog: [] });
    source.emit('sampling', 'not json {');
    source.emit('sampling', { skipped: 10 });
    source.emit('sampling', { total: 'many', active: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(messages.snapshot().sampling).toBeNull();
    expect(messages.snapshot().total).toBe(0);
    expect(store.getState().publishRate).toBe(0);
  });

  it('works without a message log: a sampling report still counts for the rate', async () => {
    const { store, source } = setup();
    source.emit('snapshot', { ...view, publishLog: [] });
    source.emit('sampling', report({ skipped: 30 }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().publishRate).toBe(30);
  });

  it('keeps 200 rows, an exact total and a handful of notifications through 10,000 published events', async () => {
    const messages = new MessageLog();
    const { store, source } = setup({ messages });
    source.emit('snapshot', { ...view, publishLog: [], publishTotal: 0 });
    const before = store.getState().view;
    const listener = vi.fn();
    messages.subscribe(listener);

    for (let id = 1; id <= 10_000; id++) source.emit('published', published(id));
    await vi.advanceTimersByTimeAsync(1000);

    expect(messages.snapshot().rows).toHaveLength(200);
    expect(messages.snapshot().total).toBe(10_000);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(2);
    expect(store.getState().publishRate).toBe(10_000);
    expect(store.getState().view).toBe(before);
  });

  it('keeps a republished message out of the history but lists it in the log', () => {
    const history = new HistoryStore();
    const messages = new MessageLog();
    const { source } = setup({ history, messages });
    source.emit('snapshot', { ...view, publishLog: [], publishTotal: 0 });
    source.emit('published', published(1));
    source.emit('published', published(2, { fault: 'republish', payload: published(1).payload }));
    vi.advanceTimersByTime(1000);
    expect(history.series('dc-env-01', 'temperature_c')).toHaveLength(1);
    expect(ids(messages)).toEqual([2, 1]);
  });
});

describe('the benchmark (SIM-15)', () => {
  const going = benchmarkFixture.current as BenchmarkRunDetail;
  const summaryOf = (run: BenchmarkRunDetail): BenchmarkRunSummary => {
    const summary: Partial<BenchmarkRunDetail> = structuredClone(run);
    delete summary.series;
    return summary as BenchmarkRunSummary;
  };
  /** What a snapshot says about the benchmark while run 3 goes: the summaries, no series. */
  const runningSummary: BenchmarkSummary = {
    ...view.benchmark,
    running: true,
    current: summaryOf(going),
    runs: benchmarkFixture.runs.map(summaryOf),
  };
  const snapshotWith = (benchmark: BenchmarkSummary = runningSummary): Snapshot => ({
    ...view,
    benchmark,
    publishLog: [],
  });
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('seeds the summary of a snapshot, and reads the series of the runs it names', async () => {
    const benchmark = new BenchmarkStore();
    const getBenchmark = vi.fn(async () => benchmarkFixture);
    const { source } = setup({ benchmark, getBenchmark });
    source.emit('snapshot', snapshotWith());
    expect(benchmark.get().status).toEqual({ id: 3, phase: 'publishing' });
    expect(benchmark.get().current?.series).toEqual([]);

    await settle();
    expect(getBenchmark).toHaveBeenCalledTimes(1);
    expect(benchmark.get().current?.series).toHaveLength(going.series.length);
    expect(benchmark.get().runs.map((run) => run.id)).toEqual([2, 1]);
  });

  it('reads nothing when the simulator has no run to name, or cannot run one', async () => {
    const benchmark = new BenchmarkStore();
    const getBenchmark = vi.fn(async () => benchmarkFixture);
    const { source } = setup({ benchmark, getBenchmark });
    source.emit('snapshot', snapshotWith({ ...view.benchmark, current: null, runs: [] }));
    source.emit(
      'snapshot',
      snapshotWith({ ...runningSummary, available: false, reason: 'not configured' }),
    );
    await settle();
    expect(getBenchmark).not.toHaveBeenCalled();
    expect(benchmark.get().status).toEqual({ id: 3, phase: 'publishing' });
  });

  it('applies each benchmark event to the store: a point, a phase, the end', () => {
    const benchmark = new BenchmarkStore();
    const { source } = setup({ benchmark });
    const point = {
      t: 11,
      published: 63000,
      stored: 125000,
      buffered: 700,
      flushP95S: 0.02,
      queueDelayS: 0.1,
    };
    source.emit('benchmark', {
      run: { ...summaryOf(going), elapsedMs: 11_000 },
      point,
    });
    expect(benchmark.get().current?.series).toEqual([point]);

    source.emit('benchmark', {
      run: { ...summaryOf(going), phase: 'ended', outcome: 'completed', elapsedMs: 20_000 },
      point: null,
    });
    expect(benchmark.get().status).toBeNull();
    expect(benchmark.get().runs[0]?.outcome).toBe('completed');
  });

  it('does not touch the view in the store: a run changing is not a state event', () => {
    const benchmark = new BenchmarkStore();
    const { store, source } = setup({ benchmark });
    source.emit('snapshot', snapshotWith({ ...view.benchmark, current: null, runs: [] }));
    const before = store.getState().view;
    source.emit('benchmark', { run: summaryOf(going), point: null });
    expect(store.getState().view).toBe(before);
    expect(benchmark.get().status).toEqual({ id: 3, phase: 'publishing' });
  });

  it('ignores a benchmark event that is not JSON, names no run, or carries a point that is not one', () => {
    const benchmark = new BenchmarkStore();
    const { source } = setup({ benchmark });
    source.emit('benchmark', 'not json');
    source.emit('benchmark', {});
    source.emit('benchmark', { run: { id: 'three' } });
    source.emit('benchmark', { run: null, point: null });
    expect(benchmark.get().status).toBeNull();

    source.emit('benchmark', { run: summaryOf(going), point: 'late' });
    expect(benchmark.get().current?.series).toEqual([]);
  });

  it('keeps an event that arrived while the read was on its way', async () => {
    const benchmark = new BenchmarkStore();
    const release: (() => void)[] = [];
    const getBenchmark = vi.fn(
      () =>
        new Promise<BenchmarkDetail>((resolve) => {
          release.push(() => resolve(benchmarkFixture));
        }),
    );
    const { source } = setup({ benchmark, getBenchmark });
    source.emit('snapshot', snapshotWith());
    const late = {
      t: 11,
      published: 63000,
      stored: 125000,
      buffered: 700,
      flushP95S: 0.02,
      queueDelayS: 0.1,
    };
    source.emit('benchmark', { run: { ...summaryOf(going), elapsedMs: 11_000 }, point: late });

    release[0]?.();
    await settle();
    expect(benchmark.get().current?.series.map((p) => p.t)).toEqual([
      ...going.series.map((p) => p.t),
      11,
    ]);
  });

  it('does not let a read that ended undo a run that ended meanwhile', async () => {
    const benchmark = new BenchmarkStore();
    const release: (() => void)[] = [];
    const getBenchmark = vi.fn(
      () =>
        new Promise<BenchmarkDetail>((resolve) => {
          release.push(() => resolve(benchmarkFixture));
        }),
    );
    const { source } = setup({ benchmark, getBenchmark });
    source.emit('snapshot', snapshotWith());
    source.emit('benchmark', {
      run: { ...summaryOf(going), phase: 'ended', outcome: 'completed', elapsedMs: 20_000 },
      point: null,
    });
    release[0]?.();
    await settle();
    expect(benchmark.get().current).toBeNull();
    expect(benchmark.get().runs[0]?.id).toBe(3);
  });

  it('cancels the read going on when a newer snapshot arrives, and only the newer one writes', async () => {
    const benchmark = new BenchmarkStore();
    const signals: AbortSignal[] = [];
    const release: (() => void)[] = [];
    const getBenchmark = vi.fn(
      (options: { signal?: AbortSignal }) =>
        new Promise<BenchmarkDetail>((resolve) => {
          if (options.signal) signals.push(options.signal);
          // The first answer is one that must never be written: it names a run that the second does not.
          const stray = signals.length === 1;
          release.push(() =>
            resolve(
              stray ? { ...benchmarkFixture, current: { ...going, id: 9 } } : benchmarkFixture,
            ),
          );
        }),
    );
    const { source } = setup({ benchmark, getBenchmark });
    source.emit('snapshot', snapshotWith());
    source.emit('snapshot', snapshotWith());
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    release[0]?.();
    release[1]?.();
    await settle();
    expect(benchmark.get().current?.id).toBe(3);
    expect(benchmark.get().current?.series).toHaveLength(going.series.length);
  });

  it('leaves the store as it is when the read fails, and reads again at the next snapshot', async () => {
    const benchmark = new BenchmarkStore();
    const getBenchmark = vi
      .fn<() => Promise<BenchmarkDetail>>()
      .mockRejectedValueOnce(new Error('Cannot reach the simulator'))
      .mockResolvedValue(benchmarkFixture);
    const { source } = setup({ benchmark, getBenchmark });
    source.emit('snapshot', snapshotWith());
    await settle();
    expect(benchmark.get().status).toEqual({ id: 3, phase: 'publishing' });
    expect(benchmark.get().current?.series).toEqual([]);

    source.emit('snapshot', snapshotWith());
    await settle();
    expect(benchmark.get().current?.series).toHaveLength(going.series.length);
  });

  it('does not write a read that finished after it was closed', async () => {
    const benchmark = new BenchmarkStore();
    const signals: AbortSignal[] = [];
    const release: (() => void)[] = [];
    const getBenchmark = vi.fn(
      (options: { signal?: AbortSignal }) =>
        new Promise<BenchmarkDetail>((resolve) => {
          if (options.signal) signals.push(options.signal);
          release.push(() => resolve(benchmarkFixture));
        }),
    );
    const { source, connection } = setup({ benchmark, getBenchmark });
    source.emit('snapshot', snapshotWith());
    connection.close();
    expect(signals[0]?.aborted).toBe(true);
    release[0]?.();
    await settle();
    expect(benchmark.get().current?.series).toEqual([]);
  });

  it('copes with a simulator that sends no benchmark section, and works without a store', async () => {
    const benchmark = new BenchmarkStore();
    const getBenchmark = vi.fn(async () => benchmarkFixture);
    const old: Partial<Snapshot> = { ...view, publishLog: [] };
    delete old.benchmark;
    const withStore = setup({ benchmark, getBenchmark });
    withStore.source.emit('snapshot', old);
    await settle();
    expect(getBenchmark).not.toHaveBeenCalled();
    expect(benchmark.get().status).toBeNull();

    const without = setup({ getBenchmark });
    without.source.emit('snapshot', snapshotWith());
    without.source.emit('benchmark', { run: summaryOf(going), point: null });
    await settle();
    expect(getBenchmark).not.toHaveBeenCalled();
  });
});

describe('the session metrics (SIM-15)', () => {
  const feedAt = (second: number, messages: number): MetricsFeed => ({
    samples: [
      { name: 'telemetry_messages_total', labels: { result: 'accepted' }, value: messages },
      { name: 'telemetry_buffered_readings', labels: {}, value: 5 },
    ],
    lastOkAt: new Date(T0 + second * 1000).toISOString(),
    stale: false,
  });

  it('records the metrics of a snapshot and of each metrics event, and still replaces the slice', () => {
    const sessionMetrics = new SessionMetricsStore();
    const { store, source } = setup({ sessionMetrics });
    source.emit('snapshot', { ...view, metrics: feedAt(0, 100), publishLog: [] });
    source.emit('metrics', feedAt(2, 700));
    expect(sessionMetrics.get().points.map((point) => point.messagesPerS)).toEqual([null, 300]);
    expect(store.getState().view?.metrics.lastOkAt).toBe(feedAt(2, 700).lastOkAt);
  });

  it('ignores a metrics body that is not a feed, but a stale feed still ends the chain', () => {
    const sessionMetrics = new SessionMetricsStore();
    const { source } = setup({ sessionMetrics });
    source.emit('metrics', feedAt(0, 100));
    source.emit('metrics', { lastOkAt: null, stale: true });
    source.emit('metrics', { ...feedAt(5, 900), stale: true, samples: [] });
    source.emit('metrics', feedAt(6, 1000));
    expect(sessionMetrics.get().points.map((point) => point.messagesPerS)).toEqual([null, null]);
  });

  it('works without a store', () => {
    const { store, source } = setup();
    source.emit('metrics', feedAt(0, 100));
    expect(store.getState().view).toBeNull();
  });
});

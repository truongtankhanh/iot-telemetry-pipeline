import {
  getObservations as fetchObservations,
  getState as fetchState,
  type ObservationsRequest,
  type RequestOptions,
} from '../api/client';
import type {
  ObservationEvent,
  ObservationsPage,
  PublishedMessage,
  SamplingReport,
  Snapshot,
  StateView,
} from '../api/types';
import { RateCounter } from '../lib/rate';
import type { HistoryStore } from './history';
import type { MessageLog } from './messageLog';
import { OBSERVATION_CAPACITY, type ObservationLog } from './observationLog';
import type { PulseBus } from './pulses';
import type { StudioStore } from './store';

/** The part of `EventSource` the stream uses, so a test can pass a fake (jsdom has none). */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export interface StreamOptions {
  url?: string;
  createSource?: (url: string) => EventSourceLike;
  /** Reads the whole state again; defaults to `GET /api/state`. */
  getState?: () => Promise<StateView>;
  now?: () => number;
  /** A burst of `state` events is one refetch, this long after the last of them. */
  refetchDelayMs?: number;
  rateWindowMs?: number;
  /** Where readings are kept for the charts: seeded by each snapshot, fed by each `published` message. */
  history?: HistoryStore;
  /** Told when each device publishes, for the dots on the topology's edges (nothing renders per message). */
  pulses?: PulseBus;
  /** The messages of the Event stream: seeded by each snapshot, fed by each `published` message and each `sampling` report. */
  messages?: MessageLog;
  /** How often the publish rate is written to the store. */
  rateEveryMs?: number;
  /**
   * Where the simulator's observations are kept for the timeline: fed by each `observation` event, and filled from
   * `GET /api/observations` when a snapshot shows the log is behind (see `connectStream`). Without it they are ignored.
   */
  observations?: ObservationLog;
  /** Reads one page of observations; defaults to `GET /api/observations`. */
  getObservations?: (
    request: ObservationsRequest,
    options: RequestOptions,
  ) => Promise<ObservationsPage>;
}

/** The most the simulator lets one page hold. */
const OBSERVATIONS_PAGE = 500;

export interface StreamConnection {
  close(): void;
}

/**
 * Connects the store to the simulator's event stream.
 *
 * - `snapshot` (the first message of every connection, so also after a reconnect) replaces the view;
 *   `ingest`, `alerts`, `metrics` and `broker` replace their slice.
 * - `state` means an operator changed something. The change is a delta of the engine's rules, and
 *   applying it here would be a second copy of them; operator actions are rare, so the whole state is
 *   read again, once for a burst.
 * - `published` is not stored in the Zustand store: it feeds the rate and, when a `history` is given, that
 *   history (it arrives about fifteen times a second, and nothing may render per message; the history tells
 *   its listeners at most once a second). A snapshot seeds the history from its publish log, replacing what was
 *   there, so a reconnect does not double the readings. With `pulses`, each `published` message also tells that bus
 *   which device published (the topology's dots); the publish log of a snapshot is the past and is not replayed.
 * - With `messages`, the same snapshot seeds that log (the publish log, `publishTotal` and `sampling`) and each `published`
 *   message is recorded in it. The simulator **samples** `published` events when they come faster than its budget and says
 *   so with a `sampling` report once per window (`skipped`, and `total`, the exact count of every message up to then): the
 *   report's `skipped` is added to the rate at the time it arrives, so the rate stays the rate of the messages and not of
 *   the events received, and it sets the log's total and its sampling notice. Without a `sampling` event nothing changes.
 * - `observation` is recorded in `observations`, when one is given. A snapshot shows how far the simulator's log has
 *   got (`observationCursor`, the id of its newest event): when the log here is behind, it is read from the simulator
 *   newest first, page by page, to the end and added (the events that arrived live meanwhile stay; one read at a
 *   time, a newer snapshot cancels the one going on); when the cursor is _lower_ than what the log holds the simulator
 *   started again and its ids began at 1, so the log is cleared first. A read that fails changes nothing: the live
 *   events go on filling the log, and the next snapshot tries again.
 * - `tick-error` is not used by the shell.
 *
 * The browser reconnects an `EventSource` by itself. The link is `live` while it is open and `lost`
 * between a failure and the next open; the store keeps the last view meanwhile, and the pills show it dimmed.
 */
export function connectStream(store: StudioStore, options: StreamOptions = {}): StreamConnection {
  const url = options.url ?? '/api/stream';
  const now = options.now ?? Date.now;
  const getState = options.getState ?? (() => fetchState());
  const refetchDelayMs = options.refetchDelayMs ?? 250;
  const rateEveryMs = options.rateEveryMs ?? 1000;
  const source = (options.createSource ?? ((target: string) => new EventSource(target)))(url);
  const rate = new RateCounter(options.rateWindowMs ?? 5000, now());

  const observations = options.observations;
  const readObservations = options.getObservations ?? fetchObservations;

  let closed = false;
  let refetchTimer: ReturnType<typeof setTimeout> | undefined;
  let observationRead: AbortController | undefined;

  store.getState().setLink('connecting', now());
  source.addEventListener('open', () => store.getState().setLink('live', now()));
  source.addEventListener('error', () => store.getState().setLink('lost', now()));

  /** Listens to one event whose data is JSON; a message that is not JSON is ignored. */
  function on<T>(type: string, handle: (data: T, at: number) => void): void {
    source.addEventListener(type, (event) => {
      let data: unknown;
      try {
        data = JSON.parse((event as MessageEvent<string>).data);
      } catch {
        return;
      }
      if (typeof data === 'object' && data !== null) handle(data as T, now());
    });
  }

  /** Reads the simulator's observations to their end into the log; resolves when it is done, cancelled or failed. */
  async function fillObservations(cursor: number): Promise<void> {
    if (observations === undefined) return;
    observationRead?.abort();
    observationRead = undefined;
    if (cursor < observations.newestId()) observations.clear();
    else if (observations.newestId() >= cursor) {
      // Up to date; a read that this snapshot just cancelled must not leave the log marked as loading.
      observations.setLoading(null);
      return;
    }

    const controller = new AbortController();
    observationRead = controller;
    const collected: ObservationEvent[] = [];
    observations.setLoading(0);
    try {
      let before: number | undefined;
      for (;;) {
        const page = await readObservations(
          { limit: OBSERVATIONS_PAGE, ...(before === undefined ? {} : { before }) },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        collected.push(...page.events);
        observations.setLoading(collected.length);
        if (page.next === null || collected.length >= OBSERVATION_CAPACITY) break;
        before = page.next;
      }
      observations.seed(collected);
    } catch {
      // The log stays as it is: the live events keep filling it and the next snapshot reads again.
    } finally {
      if (!controller.signal.aborted) {
        observations.setLoading(null);
        observationRead = undefined;
      }
    }
  }

  on<Snapshot>('snapshot', (data, at) => {
    store.getState().applySnapshot(data, at);
    const publishLog = Array.isArray(data.publishLog) ? data.publishLog : [];
    options.history?.seed(publishLog);
    options.messages?.seed(publishLog, { total: data.publishTotal, sampling: data.sampling });
    if (typeof data.observationCursor === 'number') void fillObservations(data.observationCursor);
  });
  on<StateView['ingest']>('ingest', (data, at) => store.getState().patchSlice('ingest', data, at));
  on<StateView['alerts']>('alerts', (data, at) => store.getState().patchSlice('alerts', data, at));
  on<StateView['metrics']>('metrics', (data, at) =>
    store.getState().patchSlice('metrics', data, at),
  );
  on<StateView['broker']>('broker', (data, at) => store.getState().patchSlice('broker', data, at));

  source.addEventListener('state', () => {
    if (refetchTimer !== undefined) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => {
      refetchTimer = undefined;
      getState().then(
        (view) => {
          if (!closed) store.getState().setView(view, now());
        },
        // A failed read changes nothing: the stream is still the source of truth, and its next
        // snapshot, or the next operator action, brings the state up to date.
        () => {},
      );
    }, refetchDelayMs);
  });

  on<PublishedMessage>('published', (message, at) => {
    options.history?.record(message);
    options.messages?.record(message);
    // A message that names no device cannot draw a dot on a device's edge.
    if (typeof message.deviceId === 'string')
      options.pulses?.emit(message.deviceId, at, message.fault);
  });
  source.addEventListener('published', () => rate.record(now()));
  on<SamplingReport>('sampling', (report, at) => {
    // Not a report (an older or different simulator): nothing to count and nothing to show.
    if (typeof report.total !== 'number' || typeof report.active !== 'boolean') return;
    if (typeof report.skipped === 'number') rate.record(at, report.skipped);
    options.messages?.applySampling(report);
  });
  on<ObservationEvent>('observation', (event) => {
    // An event without an id cannot be told from another, and could not be kept once.
    if (typeof event.id === 'number') observations?.record(event);
  });

  const rateTimer = setInterval(() => {
    const next = Math.round(rate.perSecond(now()) * 10) / 10;
    if (next !== store.getState().publishRate) store.getState().setPublishRate(next);
  }, rateEveryMs);

  return {
    close() {
      closed = true;
      observationRead?.abort();
      observations?.setLoading(null);
      if (refetchTimer !== undefined) clearTimeout(refetchTimer);
      clearInterval(rateTimer);
      source.close();
    },
  };
}

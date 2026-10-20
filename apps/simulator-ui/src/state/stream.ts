import { getState as fetchState } from '../api/client';
import type { Snapshot, StateView } from '../api/types';
import { RateCounter } from '../lib/rate';
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
  /** How often the publish rate is written to the store. */
  rateEveryMs?: number;
}

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
 * - `published` is not stored: it only feeds the rate (it arrives about fifteen times a second, and
 *   nothing in the shell may render per message).
 * - `tick-error` and `observation` are not used by the shell.
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

  let closed = false;
  let refetchTimer: ReturnType<typeof setTimeout> | undefined;

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

  on<Snapshot>('snapshot', (data, at) => store.getState().applySnapshot(data, at));
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

  source.addEventListener('published', () => rate.record(now()));

  const rateTimer = setInterval(() => {
    const next = Math.round(rate.perSecond(now()) * 10) / 10;
    if (next !== store.getState().publishRate) store.getState().setPublishRate(next);
  }, rateEveryMs);

  return {
    close() {
      closed = true;
      if (refetchTimer !== undefined) clearTimeout(refetchTimer);
      clearInterval(rateTimer);
      source.close();
    },
  };
}

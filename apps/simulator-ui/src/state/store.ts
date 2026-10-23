import { createStore, type StoreApi } from 'zustand';
import type { Snapshot, StateView } from '../api/types';

/** The link between this page and the simulator's event stream. */
export type LinkState = 'connecting' | 'live' | 'lost';

/** The parts of the state view that have a stream event of their own. */
export type SliceKey = 'ingest' | 'alerts' | 'metrics' | 'broker';

/**
 * Everything the shell shows, in one store. The simulator is the source of truth: the stream's
 * `snapshot` replaces `view`, the other events replace a slice of it. The published messages are not
 * kept here (a page that needs them reads the stream itself); only a rate is.
 */
export interface StudioState {
  link: LinkState;
  /** When the link was lost (ms since the epoch); `null` while connecting or live. */
  lostSince: number | null;
  /** The last state the simulator sent, or `null` before the first message. */
  view: StateView | null;
  /** When any message last arrived. With `link` it says how stale `view` is. */
  lastDataAt: number | null;
  /**
   * What ingest last said about its alert sink (`none` or `ops-command-center`). `view.ingest` forgets
   * it while ingest is unreachable; the Command Center pill shows the last known value, dimmed.
   */
  lastAlertSink: string | null;
  /** Messages per second the stream is carrying, updated about once a second. */
  publishRate: number;
  /** Whether the icon rail is pinned open (a per-viewer preference, persisted by the app). */
  railPinned: boolean;
  paletteOpen: boolean;
  /**
   * How many modal sheets or dialogs are open (the inspector, the hold dialog). While there is one, the shell behind
   * it is inert. A count and not a flag, so two that overlap for a moment do not release the shell early.
   */
  modalCount: number;

  applySnapshot(snapshot: Snapshot, at: number): void;
  setView(view: StateView, at: number): void;
  patchSlice<K extends SliceKey>(key: K, value: StateView[K], at: number): void;
  setLink(link: LinkState, at: number): void;
  setPublishRate(rate: number): void;
  setRailPinned(pinned: boolean): void;
  setPaletteOpen(open: boolean): void;
  pushModal(): void;
  popModal(): void;
}

export type StudioStore = StoreApi<StudioState>;

/**
 * A snapshot without the publish log and what goes with it (the count of every message and the sampling notice): they
 * are the stream's to show, in the message log, not the store's to hold, and a message arrives hundreds of times a second.
 */
function withoutLog(snapshot: Snapshot): StateView {
  const view: Partial<Snapshot> = { ...snapshot };
  delete view.publishLog;
  delete view.publishTotal;
  delete view.sampling;
  return view as StateView;
}

const rememberSink = (view: StateView, previous: string | null) =>
  view.ingest.alertSink ?? previous;

/** A store of its own, so a test (or a second window) never shares state through a global. */
export function createStudioStore(initial: { railPinned?: boolean } = {}): StudioStore {
  return createStore<StudioState>()((set) => ({
    link: 'connecting',
    lostSince: null,
    view: null,
    lastDataAt: null,
    lastAlertSink: null,
    publishRate: 0,
    railPinned: initial.railPinned ?? false,
    paletteOpen: false,
    modalCount: 0,

    applySnapshot: (snapshot, at) =>
      set((state) => {
        const view = withoutLog(snapshot);
        return { view, lastDataAt: at, lastAlertSink: rememberSink(view, state.lastAlertSink) };
      }),
    setView: (view, at) =>
      set((state) => ({
        view,
        lastDataAt: at,
        lastAlertSink: rememberSink(view, state.lastAlertSink),
      })),
    patchSlice: (key, value, at) =>
      set((state) => {
        // Before the first snapshot there is nothing to patch; the snapshot carries every slice.
        if (state.view === null) return state;
        const view = { ...state.view, [key]: value };
        return { view, lastDataAt: at, lastAlertSink: rememberSink(view, state.lastAlertSink) };
      }),
    setLink: (link, at) =>
      set((state) => ({
        link,
        lostSince: link === 'lost' ? (state.lostSince ?? at) : null,
      })),
    setPublishRate: (publishRate) => set({ publishRate }),
    setRailPinned: (railPinned) => set({ railPinned }),
    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    pushModal: () => set((state) => ({ modalCount: state.modalCount + 1 })),
    popModal: () => set((state) => ({ modalCount: Math.max(0, state.modalCount - 1) })),
  }));
}

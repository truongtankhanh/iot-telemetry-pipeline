import type { PublishedMessage } from '../api/types';

/** One reading: when it was measured (ms since the epoch, the message's `ts`) and its value. */
export interface Sample {
  t: number;
  v: number;
}

export interface HistoryOptions {
  /** How far back a series is kept, measured from its newest sample. */
  windowMs?: number;
  /** A hard cap per series, so a very short interval cannot grow a series without bound. */
  maxPoints?: number;
  /** Listeners hear about live data at most this often (a message arrives about fifteen times a second). */
  notifyEveryMs?: number;
}

/** What a device-level reader needs, as of the last notification. */
export interface DeviceSnapshot {
  /** When the device's newest message was measured, or `null` if none is known. */
  lastSeen: number | null;
  /** The device's newest message as it was published (topic and payload text included). */
  last: PublishedMessage | null;
}

const NO_DEVICE: DeviceSnapshot = { lastSeen: null, last: null };
const NO_SAMPLES: readonly Sample[] = [];

const DEFAULTS = { windowMs: 120_000, maxPoints: 600, notifyEveryMs: 1000 } as const;

/** The key of one metric of one device. Not a valid device id or metric name, so it cannot collide with one. */
export const seriesKey = (deviceId: string, metric: string) => `${deviceId}\u0000${metric}`;

/** The metrics of a published payload (`{ seq, ts, metrics }`); nothing for a payload that is not that. */
function metricsOf(payload: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return {};
  }
  const metrics = (parsed as { metrics?: unknown } | null)?.metrics;
  if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) return {};
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(metrics)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
  }
  return out;
}

/**
 * The last two minutes of every device's readings, for the charts and sparklines, and the last message of each
 * device. It is built in the browser from the stream (`published` events, and the snapshot's publish log when a
 * connection opens), so after a reload it holds what the simulator remembered (the last 200 messages) and fills
 * from there; a chart says how much it has instead of guessing.
 *
 * It lives outside React and outside the Zustand store on purpose: a message arrives about fifteen times a
 * second and nothing may render per message. A component subscribes to one key (a device's metric, or a device)
 * and is told at most once per `notifyEveryMs`, with the version of that key to compare.
 */
export class HistoryStore {
  private readonly windowMs: number;
  private readonly maxPoints: number;
  private readonly notifyEveryMs: number;
  private readonly points = new Map<string, Sample[]>();
  private readonly seen = new Map<string, number>();
  private readonly payloads = new Map<string, PublishedMessage>();
  private readonly versions = new Map<string, number>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly dirty = new Set<string>();
  // What readers get between notifications: the same object until the next notification, so that
  // `useSyncExternalStore` sees an unchanged snapshot as unchanged.
  private readonly seriesSnapshots = new Map<string, readonly Sample[]>();
  private readonly deviceSnapshots = new Map<string, DeviceSnapshot>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: HistoryOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULTS.windowMs;
    this.maxPoints = options.maxPoints ?? DEFAULTS.maxPoints;
    this.notifyEveryMs = options.notifyEveryMs ?? DEFAULTS.notifyEveryMs;
  }

  /** Records a message that arrived live. Listeners hear about it within `notifyEveryMs`. */
  record(message: PublishedMessage): void {
    this.add(message);
    this.scheduleNotify();
  }

  /**
   * Replaces everything with these messages (oldest first), as the first message of a connection does, so a
   * reconnect does not double what was already here. Listeners are told at once.
   */
  seed(messages: readonly PublishedMessage[]): void {
    const known = [...this.versions.keys()];
    this.points.clear();
    this.seen.clear();
    this.payloads.clear();
    for (const key of known) this.dirty.add(key);
    for (const message of messages) this.add(message);
    this.flush();
  }

  /** The device's readings of one metric inside the window, oldest first. A new array each call. */
  series(deviceId: string, metric: string): Sample[] {
    return [...(this.points.get(seriesKey(deviceId, metric)) ?? [])];
  }

  /**
   * The same readings as `series`, as they were at the last notification and as one object until the next:
   * what a component reads. Do not change it.
   */
  snapshot(deviceId: string, metric: string): readonly Sample[] {
    const key = seriesKey(deviceId, metric);
    let snapshot = this.seriesSnapshots.get(key);
    if (!snapshot) {
      const live = this.points.get(key);
      snapshot = live && live.length > 0 ? [...live] : NO_SAMPLES;
      this.seriesSnapshots.set(key, snapshot);
    }
    return snapshot;
  }

  /** The device's last message, as of the last notification and as one object until the next. */
  deviceSnapshot(deviceId: string): DeviceSnapshot {
    let snapshot = this.deviceSnapshots.get(deviceId);
    if (!snapshot) {
      const last = this.payloads.get(deviceId) ?? null;
      snapshot = last ? { lastSeen: this.seen.get(deviceId) ?? null, last } : NO_DEVICE;
      this.deviceSnapshots.set(deviceId, snapshot);
    }
    return snapshot;
  }

  /** When the device's newest message was measured, or `null` if none is known. */
  lastSeen(deviceId: string): number | null {
    return this.seen.get(deviceId) ?? null;
  }

  /** The device's newest message, as it was published (topic and payload text included). */
  lastPayload(deviceId: string): PublishedMessage | null {
    return this.payloads.get(deviceId) ?? null;
  }

  /** Changes when something under the key changed and its listeners were told; for `useSyncExternalStore`. */
  versionOf(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Stops the pending notification; the data stays. */
  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private add(message: PublishedMessage): void {
    const t = Date.parse(message.ts);
    if (!Number.isFinite(t)) return;
    const { deviceId } = message;

    const newest = this.seen.get(deviceId);
    if (newest === undefined || t >= newest) {
      this.seen.set(deviceId, t);
      this.payloads.set(deviceId, message);
    }
    this.dirty.add(deviceId);

    for (const [metric, v] of Object.entries(metricsOf(message.payload))) {
      const key = seriesKey(deviceId, metric);
      let list = this.points.get(key);
      if (!list) {
        list = [];
        this.points.set(key, list);
      }
      // Almost always the newest; a late message is placed where its time says.
      let at = list.length;
      while (at > 0 && (list[at - 1] as Sample).t > t) at -= 1;
      list.splice(at, 0, { t, v });
      this.trim(list);
      this.dirty.add(key);
    }
  }

  private trim(list: Sample[]): void {
    const newest = (list[list.length - 1] as Sample).t;
    let drop = 0;
    while (drop < list.length && (list[drop] as Sample).t < newest - this.windowMs) drop += 1;
    drop = Math.max(drop, list.length - this.maxPoints);
    if (drop > 0) list.splice(0, drop);
  }

  private scheduleNotify(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, this.notifyEveryMs);
  }

  private flush(): void {
    const keys = [...this.dirty];
    this.dirty.clear();
    for (const key of keys) {
      this.seriesSnapshots.delete(key);
      this.deviceSnapshots.delete(key);
      this.versions.set(key, this.versionOf(key) + 1);
      for (const listener of this.listeners.get(key) ?? []) listener();
    }
  }
}

/**
 * The few things Studio remembers for one viewer in one browser. They are conveniences, never state the
 * demo depends on: storage can be missing, full, or blocked (a private window, cleared site data, a
 * thumbnail render), and every read and write is allowed to fail without anyone noticing.
 */
const RAIL_PINNED_KEY = 'studio.railPinned';
const TIME_ZONE_KEY = 'studio.timeZone';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's storage, or `null` when even asking for it throws. */
function browserStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Whether the icon rail was pinned open. `false` when nothing was stored, or storage is unusable. */
export function readRailPinned(storage: StorageLike | null = browserStorage()): boolean {
  try {
    return storage?.getItem(RAIL_PINNED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeRailPinned(
  pinned: boolean,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(RAIL_PINNED_KEY, pinned ? 'true' : 'false');
  } catch {
    // Not remembered; the pin still works for this visit.
  }
}

/** How the event timeline writes its times: in the viewer's own time zone, or in UTC. */
export type TimeZoneChoice = 'local' | 'utc';

/** The zone the timeline shows; `local` when nothing was stored (or anything but `utc`), or storage is unusable. */
export function readTimeZone(storage: StorageLike | null = browserStorage()): TimeZoneChoice {
  try {
    return storage?.getItem(TIME_ZONE_KEY) === 'utc' ? 'utc' : 'local';
  } catch {
    return 'local';
  }
}

export function writeTimeZone(
  choice: TimeZoneChoice,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(TIME_ZONE_KEY, choice);
  } catch {
    // Not remembered; the choice still holds for this visit.
  }
}

import { type AppRoute, routeByGoKey } from './routes';

/** The part of a keyboard event the shortcuts read, so a test can build one without a DOM. */
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: unknown;
}

export type ShortcutAction = { type: 'open-palette' } | { type: 'go'; path: string };

/** True in a field where a letter is text: an input, a textarea, a select or an editable element. */
export function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
  return (
    tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true
  );
}

/**
 * The keyboard of the shell: `⌘ K` (or Ctrl K) and `/` open the palette, `g` then a letter within a
 * second goes to a page. `⌘ K` works from anywhere, a field included; every single-key shortcut is
 * ignored while focus is in a field, and with a modifier held (the browser's own shortcuts stay theirs).
 *
 * Returns the action for a key press, or `null` when it is not Studio's. The caller prevents the
 * browser default only when there is an action.
 */
export function createShortcuts(
  routes: AppRoute[],
  options: { now?: () => number; goWindowMs?: number } = {},
): (event: KeyEventLike) => ShortcutAction | null {
  const now = options.now ?? Date.now;
  const goWindowMs = options.goWindowMs ?? 1000;
  let goPressedAt: number | null = null;

  return (event) => {
    const at = now();
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && !event.altKey && key === 'k') {
      goPressedAt = null;
      return { type: 'open-palette' };
    }
    if (modifier || event.altKey || isEditableTarget(event.target)) {
      goPressedAt = null;
      return null;
    }

    if (goPressedAt !== null && at - goPressedAt <= goWindowMs) {
      goPressedAt = null;
      const route = routeByGoKey(routes, key);
      return route ? { type: 'go', path: route.path } : null;
    }
    goPressedAt = null;

    if (key === '/') return { type: 'open-palette' };
    if (key === 'g') goPressedAt = at;
    return null;
  };
}

/**
 * The timeline editor's own shortcut: a plain `A` adds an anomaly (the brief's "`A` add anomaly in the editor"). It belongs
 * to that page, which listens for it while it is open, not to the shell. Like every single-key shortcut it is ignored in a field
 * and with a modifier held. `g` then `a` is the shell's "go to Alerts", so an `A` within a second of a `g` is not this one.
 */
export function createAddAnomalyShortcut(
  options: { now?: () => number; goWindowMs?: number } = {},
): (event: KeyEventLike) => boolean {
  const now = options.now ?? Date.now;
  const goWindowMs = options.goWindowMs ?? 1000;
  let goPressedAt: number | null = null;

  return (event) => {
    const at = now();
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) {
      goPressedAt = null;
      return false;
    }
    const afterGo = goPressedAt !== null && at - goPressedAt <= goWindowMs;
    goPressedAt = key === 'g' ? at : null;
    return key === 'a' && !afterGo;
  };
}

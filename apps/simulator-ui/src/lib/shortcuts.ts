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

/** What a key does in presenter mode (the guided demo). */
export type PresenterAction = 'next' | 'back' | 'pause' | 'restart' | 'notes' | 'exit';

/** A target whose own action is `Space`: a button, a link, a summary, a select, or anything that says it is a button. */
function isInteractiveTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const element = target as { tagName?: unknown; getAttribute?: unknown };
  const tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
  if (tag === 'button' || tag === 'a' || tag === 'summary' || tag === 'select') return true;
  if (typeof element.getAttribute !== 'function') return false;
  const role = (element.getAttribute as (name: string) => unknown).call(target, 'role');
  return role === 'button' || role === 'link' || role === 'checkbox' || role === 'switch';
}

/**
 * The keyboard of presenter mode (frame 08): `Space` next, `←` back, `P` pause the devices, `R` restart the step, `N` the presenter
 * notes, `Esc` exit. It belongs to the guided demo, which listens for it only while presenting, not to the shell. Like every single-key
 * shortcut it is ignored in a field and with a modifier held. `Space` is also ignored on a button, a link or another control that has an
 * action of its own for it (the Next button's own action is the same, and "Restart step" must not skip a step). `g` then a letter is the
 * shell's go-to, so a `p`, `r` or `n` within a second of a `g` is not this one.
 *
 * Returns the action, or `null` when the key is not presenter mode's. The caller prevents the browser default (`Space` scrolls) only
 * when there is an action. Whether the palette or a dialog is open is the caller's to say: they own `Esc` then.
 */
export function createPresenterShortcuts(
  options: { now?: () => number; goWindowMs?: number } = {},
): (event: KeyEventLike) => PresenterAction | null {
  const now = options.now ?? Date.now;
  const goWindowMs = options.goWindowMs ?? 1000;
  let goPressedAt: number | null = null;

  return (event) => {
    const at = now();
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) {
      goPressedAt = null;
      return null;
    }
    const afterGo = goPressedAt !== null && at - goPressedAt <= goWindowMs;
    goPressedAt = key === 'g' ? at : null;

    switch (key) {
      case ' ':
        return isInteractiveTarget(event.target) ? null : 'next';
      case 'ArrowLeft':
        return 'back';
      case 'Escape':
        return 'exit';
      case 'p':
        return afterGo ? null : 'pause';
      case 'r':
        return afterGo ? null : 'restart';
      case 'n':
        return afterGo ? null : 'notes';
      default:
        return null;
    }
  };
}

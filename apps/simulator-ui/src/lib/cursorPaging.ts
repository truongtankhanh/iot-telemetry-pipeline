/**
 * Paging by cursor, as `GET /api/alerts` offers it: one way (older), with no page numbers and no total. The only
 * way back is to remember where each page began, so Studio keeps the cursors the API gave it, in order. A cursor
 * is a value to hand back unchanged: it is never built, read or edited here.
 */

/**
 * The `before` that opened each page after the first, oldest page last. Empty is the newest page. `readonly`
 * on purpose: every move returns a new stack, so a render can compare two of them by identity.
 */
export type CursorStack = readonly string[];

export const NEWEST_PAGE: CursorStack = [];

/** The `before` to send for the page on show, or `undefined` for the newest page (which has none). */
export const cursorOf = (stack: CursorStack): string | undefined => stack[stack.length - 1];

/** How many pages older than the newest one is on show. */
export const depthOf = (stack: CursorStack): number => stack.length;

export const canGoNewer = (stack: CursorStack): boolean => stack.length > 0;

/** There is an older page only when the page on show came with a cursor to it. */
export const canGoOlder = (next: string | null): boolean => next !== null && next !== '';

/** One page older: `next` is the cursor the page on show came with. Unchanged when there is none. */
export function goOlder(stack: CursorStack, next: string | null): CursorStack {
  return canGoOlder(next) ? [...stack, next as string] : stack;
}

/** One page newer. Unchanged on the newest page. */
export function goNewer(stack: CursorStack): CursorStack {
  return canGoNewer(stack) ? stack.slice(0, -1) : stack;
}

/**
 * What a polite status line says about the page on show: a count and where in the order it is, never a page
 * number or a total (the API gives neither, and a number would be wrong after a reload).
 */
export function positionText(stack: CursorStack, shown: number): string {
  if (shown === 0) return 'No alerts on this page';
  const count = `Showing ${shown} ${shown === 1 ? 'alert' : 'alerts'}`;
  return depthOf(stack) === 0 ? `${count} · newest first` : `${count} · older alerts, newest first`;
}

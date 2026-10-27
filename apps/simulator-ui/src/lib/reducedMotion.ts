/**
 * Whether the viewer asked for less motion. Read at the moment something would move (a dot, a beacon), not once, because
 * the setting can change while the page is open. `CameraRig` and `useEdgeDots` each carry their own copy of this one-liner;
 * the twin's new code shares this one.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

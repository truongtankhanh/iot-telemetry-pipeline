/**
 * What the digital twin asks of the browser, kept apart from the scene so the page can find out before it requests the
 * scene's code: a device that cannot draw it must not download it (docs/design/simulator/digital-twin.md, "Performance").
 * Nothing here imports three.js.
 */

/** The part of a canvas the probe uses; a real `HTMLCanvasElement` fits, and a test passes its own. */
export interface ProbeCanvas {
  getContext(contextId: string): unknown;
}

/** The part of a canvas the context-loss watch uses: the events it fires. */
export type ContextTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** The timers the watch uses; the defaults are the page's, a test passes fakes. */
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** How long a lost context may take to come back before the twin gives way to Topology (ADR-0020). */
export const CONTEXT_GRACE_MS = 5000;

const pageTimers: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Whether a WebGL 2 context can be created here. It creates one on a throwaway canvas and gives it back at once, since
 * a browser holds only a few contexts and a page that only asks must not keep one. It never throws: a browser that
 * refuses, or has no canvas, answers `false`.
 */
export function webgl2Available(
  createCanvas: () => ProbeCanvas = () => document.createElement('canvas'),
): boolean {
  try {
    const context = createCanvas().getContext('webgl2') as {
      getExtension(name: string): { loseContext(): void } | null;
    } | null;
    if (!context) return false;
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Calls `onFallback` once when a context that was lost has not come back within `graceMs`. A loss is not final if the
 * default is prevented, so the browser may restore it; a restore inside the grace period cancels the wait. Returns what
 * stops watching: it removes both listeners and the timer.
 */
export function watchContextLoss(
  target: ContextTarget,
  onFallback: () => void,
  options: { graceMs?: number; timers?: Timers } = {},
): () => void {
  const graceMs = options.graceMs ?? CONTEXT_GRACE_MS;
  const timers = options.timers ?? pageTimers;
  let pending: unknown;
  let waiting = false;
  let fired = false;

  const onLost = (event: Event) => {
    event.preventDefault();
    if (waiting || fired) return;
    waiting = true;
    pending = timers.setTimeout(() => {
      waiting = false;
      fired = true;
      onFallback();
    }, graceMs);
  };
  const onRestored = () => {
    if (!waiting) return;
    timers.clearTimeout(pending);
    waiting = false;
  };

  target.addEventListener('webglcontextlost', onLost);
  target.addEventListener('webglcontextrestored', onRestored);
  return () => {
    target.removeEventListener('webglcontextlost', onLost);
    target.removeEventListener('webglcontextrestored', onRestored);
    if (waiting) timers.clearTimeout(pending);
    waiting = false;
  };
}

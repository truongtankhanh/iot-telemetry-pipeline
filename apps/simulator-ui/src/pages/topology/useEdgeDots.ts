import { type RefObject, useEffect } from 'react';
import type { EdgeState } from '../../lib/topology';
import { usePulseBus } from '../../state/pulseContext';
import { DotLimiter, hopKey } from '../../state/pulses';

/** How long a dot takes to cross an edge. */
export const DOT_MS = 1400;
const SVG_NS = 'http://www.w3.org/2000/svg';
const LIT: readonly EdgeState[] = ['flowing', 'warn', 'ok'];

/** The pulse keys behind an edge: its devices, or, for a pipeline edge, the hop that something downstream advanced. */
export function pulseKeys(devices: readonly string[], hop: string | null): string[] {
  if (devices.length > 0) return [...devices];
  return hop === null ? [] : [hopKey(hop)];
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface EdgeDotsOptions {
  devices: readonly string[];
  hop: string | null;
  state: EdgeState;
  /** The path the dots follow (the edge's core line). */
  path: RefObject<SVGPathElement | null>;
  /** An empty `<g>` the dots are drawn in; React never puts children in it. */
  layer: RefObject<SVGGElement | null>;
}

/**
 * Moves a dot along an edge each time something it carries was published (the brief: a dot travels a line only when
 * the engine published; at most 4 per edge; none under reduced motion). A message arrives about fifteen times a
 * second, so nothing here renders: the dots are SVG circles added to and removed from a layer by hand, moved by one
 * `requestAnimationFrame` loop that runs only while a dot is alive (D8 of the plan). An edge that is not lit (paused,
 * silent, down, or with no flow) draws none, and nothing is drawn while the tab is hidden.
 */
export function useEdgeDots({ devices, hop, state, path, layer }: EdgeDotsOptions): void {
  const bus = usePulseBus();
  const lit = LIT.includes(state);
  // A string, so the effect does not run again because a new array with the same ids was passed.
  const keysId = pulseKeys(devices, hop).join('\u0000');

  useEffect(() => {
    const line = path.current;
    const dots = layer.current;
    const keys = keysId === '' ? [] : keysId.split('\u0000');
    if (!lit || keys.length === 0 || line === null || dots === null) return;
    // Not every environment can measure a path (jsdom cannot): then there is nothing to move a dot along.
    if (typeof line.getTotalLength !== 'function' || typeof line.getPointAtLength !== 'function')
      return;

    const limiter = new DotLimiter();
    const alive = new Map<SVGCircleElement, number>();
    let frame: number | undefined;

    const step = () => {
      const now = performance.now();
      const length = line.getTotalLength();
      for (const [dot, startedAt] of [...alive]) {
        const progress = (now - startedAt) / DOT_MS;
        if (progress >= 1) {
          dot.remove();
          alive.delete(dot);
          limiter.finish();
          continue;
        }
        const point = line.getPointAtLength(progress * length);
        dot.setAttribute('cx', String(point.x));
        dot.setAttribute('cy', String(point.y));
      }
      frame = alive.size > 0 ? requestAnimationFrame(step) : undefined;
    };

    const onPulse = () => {
      if (document.hidden || prefersReducedMotion()) return;
      if (!limiter.tryStart()) return;
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('r', '3.5');
      const start = line.getPointAtLength(0);
      dot.setAttribute('cx', String(start.x));
      dot.setAttribute('cy', String(start.y));
      dots.appendChild(dot);
      alive.set(dot, performance.now());
      if (frame === undefined) frame = requestAnimationFrame(step);
    };

    const stop = bus.subscribe(keys, onPulse);
    return () => {
      stop();
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const dot of alive.keys()) dot.remove();
      alive.clear();
      limiter.reset();
    };
  }, [bus, lit, keysId, path, layer]);
}

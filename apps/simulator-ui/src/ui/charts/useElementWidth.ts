import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * The width in pixels of an element, renewed when it changes. A chart is drawn at its true pixel width, not scaled
 * from a fixed picture, so that its text stays 13 px or more. Where `ResizeObserver` does not exist (a test
 * environment) the fallback is used.
 */
export function useElementWidth<T extends HTMLElement>(
  fallback: number,
): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

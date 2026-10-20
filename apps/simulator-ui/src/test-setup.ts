import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// This file runs for every test, including the ones in scripts/ that declare `@vitest-environment node`
// (they read stylesheets from disk and have no DOM). The stubs below are for jsdom only.
if (typeof window !== 'undefined') {
  // jsdom has no `matchMedia`; the shell and the animation code read it. It reports "no match", which
  // is the default look: no wall scaling, motion allowed. A test that needs another answer replaces it.
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  // Nor does it scroll: the palette keeps the active result in view.
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
}

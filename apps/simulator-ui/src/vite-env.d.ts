/// <reference types="vite/client" />

/**
 * Set by `vite.config.ts` at build time: true in development and tests, and in a production build only
 * with `VITE_STUDIO_FOUNDATIONS=true`. Gates the internal /foundations page and its code.
 */
declare const __FOUNDATIONS__: boolean;

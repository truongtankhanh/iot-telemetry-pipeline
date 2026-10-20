/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Where `pnpm --filter @itp/simulator start` listens. The simulator serves the built UI itself, so in
// development the dev server forwards `/api` (the event stream included) to it and the browser stays
// on one origin: no CORS anywhere, as the control API sends none. The proxy keeps the `Host` header of
// the dev server (`localhost:<port>`), which the control server accepts (it checks the name, not the port).
const apiTarget = process.env.STUDIO_API_URL ?? 'http://127.0.0.1:3200';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: apiTarget } },
  },
  build: {
    // The simulator serves `dist/`; files under `dist/assets/` carry a content hash in their name,
    // which is what lets it cache them for good.
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    // CSS is not computed in jsdom; the rules that depend on it are checked from the files (scripts/).
    css: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
});

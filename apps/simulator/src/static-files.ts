import { realpathSync, statSync } from 'node:fs';
import { STATUS_CODES } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';

/**
 * The Content-Security-Policy of the pages Studio serves. Everything comes from this origin: the
 * script, the style, the fonts (bundled with the app) and the requests it makes (the commands and
 * the event stream). Nothing inline, nothing framed, no form posts.
 */
export const STATIC_CSP =
  "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const HASHED_CACHE = 'public, max-age=31536000, immutable';
const REVALIDATE_CACHE = 'no-cache';
const NOT_BUILT_HINT =
  'Studio UI is not built: run pnpm --filter @itp/simulator-ui build (or set STUDIO_DIR to a built copy)';

/** What to send for a request: a file to stream (`file`), or a small JSON `body`. */
export interface StaticResult {
  status: number;
  headers: Record<string, string>;
  /** Absolute path of the file to stream, for a 200. */
  file?: string;
  /** The JSON body of an error. */
  body?: string;
}

function failure(status: number, message: string): StaticResult {
  const body = JSON.stringify({ statusCode: status, error: STATUS_CODES[status], message });
  return {
    status,
    body,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** True when `root` holds a built Studio (an `index.html`). */
export function studioIsBuilt(root: string): boolean {
  return isFile(resolve(root, 'index.html'));
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Decides what a `GET` for `urlPath` (the path of the URL, still percent-encoded) gets from the
 * directory of the built UI.
 *
 * - `/` and any path whose last segment has no extension are the single-page app's routes: they get
 *   `index.html`, so a reload on `/fleet` works.
 * - A path with an extension is a file. If it is not one, it is a `404`, never the app's page, so a
 *   missing script is not answered with HTML.
 * - Nothing outside `root` is reachable: `..` (also encoded), dotfiles, backslashes and a symlink that
 *   leaves the directory are `404`; a NUL byte or broken percent-encoding is `400`.
 * - Files under `/assets/` carry a content hash in their name (Vite's output), so they are cached
 *   for good; everything else must be revalidated.
 */
export function resolveStatic(root: string, urlPath: string): StaticResult {
  let path: string;
  try {
    path = decodeURIComponent(urlPath);
  } catch {
    return failure(400, 'The path is not valid percent-encoding');
  }
  if (path.includes('\0')) return failure(400, 'The path is not valid');

  const segments = path.split('/').filter((segment) => segment !== '');
  if (path.includes('\\') || segments.some((s) => s === '..' || s.startsWith('.'))) {
    return failure(404, `No such file: ${urlPath}`);
  }

  const last = segments.at(-1) ?? '';
  const isRoute = extname(last) === '';
  const relativePath = isRoute ? 'index.html' : segments.join('/');
  const absRoot = resolve(root);
  const candidate = resolve(absRoot, relativePath);

  if (!inside(absRoot, candidate) || !isFile(candidate)) {
    return failure(404, isRoute ? NOT_BUILT_HINT : `No such file: ${urlPath}`);
  }
  let real: string;
  try {
    real = realpathSync(candidate);
    if (!inside(realpathSync(absRoot), real)) return failure(404, `No such file: ${urlPath}`);
  } catch {
    return failure(404, `No such file: ${urlPath}`);
  }

  const type = CONTENT_TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Length': String(statSync(real).size),
    'Cache-Control': !isRoute && segments[0] === 'assets' ? HASHED_CACHE : REVALIDATE_CACHE,
    'X-Content-Type-Options': 'nosniff',
  };
  if (type.startsWith('text/html')) {
    headers['Content-Security-Policy'] = STATIC_CSP;
    headers['Referrer-Policy'] = 'no-referrer';
  }
  return { status: 200, headers, file: real };
}

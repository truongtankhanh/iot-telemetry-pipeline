import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resolveStatic, STATIC_CSP, studioIsBuilt } from './static-files.ts';

let base: string;
let root: string;
let outside: string;
/**
 * `resolveStatic` answers with the real path of the file it checked, which differs from the one the
 * test built where the temp directory is behind a symlink (`/var` is `/private/var` on macOS).
 */
let indexFile: string;

before(() => {
  base = mkdtempSync(join(tmpdir(), 'studio-static-'));
  root = join(base, 'dist');
  outside = join(base, 'outside');
  mkdirSync(join(root, 'assets'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Studio</title>');
  indexFile = realpathSync(join(root, 'index.html'));
  writeFileSync(join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(root, 'assets', 'index-4f2a9c.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'index-4f2a9c.css'), 'body{}');
  writeFileSync(join(root, 'assets', 'geist-latin-400-9ab1.woff2'), 'font');
  writeFileSync(join(root, '.secret'), 'no');
  writeFileSync(join(outside, 'secret.txt'), 'outside the root');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'));
  symlinkSync(outside, join(root, 'linked'));
});

after(() => rmSync(base, { recursive: true, force: true }));

const body = (result: { body?: string }) =>
  JSON.parse(result.body ?? '{}') as Record<string, unknown>;

describe('resolveStatic routes of the app', () => {
  it('serves index.html at the root', () => {
    const result = resolveStatic(root, '/');
    assert.equal(result.status, 200);
    assert.equal(result.file, indexFile);
    assert.equal(result.headers['Content-Type'], 'text/html; charset=utf-8');
  });

  it('serves index.html for a route of the single-page app, so a reload works', () => {
    for (const path of ['/fleet', '/lab/scenarios', '/foundations', '/devices/dc-env-01']) {
      const result = resolveStatic(root, path);
      assert.equal(result.status, 200, path);
      assert.equal(result.file, indexFile, path);
    }
  });

  it('revalidates index.html and sends the policy and nosniff with it', () => {
    const { headers } = resolveStatic(root, '/');
    assert.equal(headers['Cache-Control'], 'no-cache');
    assert.equal(headers['Content-Security-Policy'], STATIC_CSP);
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['Referrer-Policy'], 'no-referrer');
    assert.equal(headers['Content-Length'], String('<!doctype html><title>Studio</title>'.length));
  });
});

describe('resolveStatic files', () => {
  it('serves a file with its content type', () => {
    const cases: [string, string][] = [
      ['/assets/index-4f2a9c.js', 'text/javascript; charset=utf-8'],
      ['/assets/index-4f2a9c.css', 'text/css; charset=utf-8'],
      ['/assets/geist-latin-400-9ab1.woff2', 'font/woff2'],
      ['/favicon.svg', 'image/svg+xml'],
    ];
    for (const [path, type] of cases) {
      const result = resolveStatic(root, path);
      assert.equal(result.status, 200, path);
      assert.equal(result.headers['Content-Type'], type, path);
      assert.equal(result.headers['X-Content-Type-Options'], 'nosniff', path);
    }
  });

  it('caches what is under /assets/ for good and revalidates the rest', () => {
    assert.equal(
      resolveStatic(root, '/assets/index-4f2a9c.js').headers['Cache-Control'],
      'public, max-age=31536000, immutable',
    );
    assert.equal(resolveStatic(root, '/favicon.svg').headers['Cache-Control'], 'no-cache');
  });

  it('puts the policy on HTML only', () => {
    assert.equal(
      resolveStatic(root, '/assets/index-4f2a9c.js').headers['Content-Security-Policy'],
      undefined,
    );
  });

  it('answers a missing file with 404, not with the page of the app', () => {
    for (const path of ['/assets/missing-1234.js', '/robots.txt', '/nothing.html']) {
      const result = resolveStatic(root, path);
      assert.equal(result.status, 404, path);
      assert.equal(result.file, undefined, path);
      assert.equal(body(result).statusCode, 404);
    }
  });

  it('answers an unknown extension with a generic type', () => {
    writeFileSync(join(root, 'data.bin'), 'x');
    assert.equal(
      resolveStatic(root, '/data.bin').headers['Content-Type'],
      'application/octet-stream',
    );
  });
});

describe('resolveStatic keeps to the directory', () => {
  it('refuses .. in any spelling', () => {
    for (const path of [
      '/../outside/secret.txt',
      '/assets/../../outside/secret.txt',
      '/%2e%2e/outside/secret.txt',
      '/%2E%2E%2Foutside%2Fsecret.txt',
      '/assets/%2e%2e/%2e%2e/outside/secret.txt',
    ]) {
      const result = resolveStatic(root, path);
      assert.equal(result.status, 404, path);
      assert.equal(result.file, undefined, path);
    }
  });

  it('refuses dotfiles and backslashes', () => {
    assert.equal(resolveStatic(root, '/.secret').status, 404);
    assert.equal(resolveStatic(root, '/assets/.hidden.js').status, 404);
    assert.equal(resolveStatic(root, '/assets\\index-4f2a9c.js').status, 404);
  });

  it('refuses a symlink that leaves the directory, to a file or to a folder', () => {
    assert.equal(resolveStatic(root, '/leak.txt').status, 404);
    assert.equal(resolveStatic(root, '/linked/secret.txt').status, 404);
  });

  it('refuses a NUL byte and broken percent-encoding with 400', () => {
    assert.equal(resolveStatic(root, '/assets/index%00.js').status, 400);
    assert.equal(resolveStatic(root, '/%E0%A4%A').status, 400);
  });

  it('does not read an absolute-looking path as a file path', () => {
    // No extension: it is a route of the app, so it gets index.html, never /etc/passwd.
    const result = resolveStatic(root, '//etc/passwd');
    assert.equal(result.file, indexFile);
    assert.equal(resolveStatic(root, '//etc/passwd.txt').status, 404);
  });
});

describe('resolveStatic without a build', () => {
  it('hints how to build the UI, for the root and for a route', () => {
    const empty = mkdtempSync(join(base, 'empty-'));
    for (const path of ['/', '/fleet']) {
      const result = resolveStatic(empty, path);
      assert.equal(result.status, 404);
      assert.match(String(body(result).message), /pnpm --filter @itp\/simulator-ui build/);
    }
  });

  it('copes with a directory that does not exist', () => {
    const result = resolveStatic(join(base, 'never-made'), '/');
    assert.equal(result.status, 404);
  });

  it('says whether the directory holds a build', () => {
    assert.equal(studioIsBuilt(root), true);
    assert.equal(studioIsBuilt(join(base, 'never-made')), false);
    assert.equal(studioIsBuilt(outside), false);
  });
});

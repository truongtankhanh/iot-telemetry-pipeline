import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchors, checkLinks, slug } from './check-doc-links.mjs';

const run = (files, extraTracked = []) =>
  checkLinks(new Map(Object.entries(files)), new Set([...Object.keys(files), ...extraTracked]));

test('a link to a tracked file and to a tracked folder passes', () => {
  const r = run({ 'README.md': '[a](docs/a.md) and [folder](docs/)\n', 'docs/a.md': '# A\n' });
  assert.deepEqual(r.failures, []);
  assert.equal(r.checked, 2);
});

test('a link to a file that is not tracked fails with its line', () => {
  const r = run({ 'README.md': 'x\n[t](docs/tasks/v1/README.md)\n' });
  assert.deepEqual(r.failures, [
    'README.md:2: docs/tasks/v1/README.md (no such tracked file or folder)',
  ]);
});

test('a relative path is resolved from the folder of the file that holds the link', () => {
  const r = run({
    'docs/a.md': '[b](../README.md) [c](adr/c.md)\n',
    'README.md': '',
    'docs/adr/c.md': '',
  });
  assert.deepEqual(r.failures, []);
});

test('a fragment must match a heading of the target', () => {
  const files = {
    'a.md': '[ok](b.md#hello-world) [bad](b.md#nope) [self](#top)\n# Top\n',
    'b.md': '## Hello `World`\n',
  };
  assert.deepEqual(run(files).failures, ['a.md:1: b.md#nope (no heading "#nope" in b.md)']);
});

test('a repeated heading gets -1, -2 as on GitHub', () => {
  assert.deepEqual([...anchors('# Same\n## Same\n### Same\n')], ['same', 'same-1', 'same-2']);
});

test('slugs drop punctuation and keep underscores and hyphens', () => {
  assert.equal(slug('`synchronous_commit` — fast & loose?'), 'synchronous_commit--fast--loose');
  assert.equal(slug('[Link](x.md) text'), 'link-text');
});

test('links inside code fences and code spans are ignored, external links are not fetched', () => {
  const md =
    '```md\n[x](missing.md)\n```\n`[y](missing.md)` [z](https://example.com/nope) [m](mailto:a@b.c)\n';
  const r = run({ 'README.md': md });
  assert.deepEqual(r.failures, []);
  assert.equal(r.checked, 0);
});

test('a link that leaves the repository fails', () => {
  assert.match(
    run({ 'README.md': '[x](../elsewhere.md)\n' }).failures[0],
    /outside the repository/,
  );
});

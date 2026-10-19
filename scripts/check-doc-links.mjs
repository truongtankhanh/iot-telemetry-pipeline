#!/usr/bin/env node
// Checks the relative links of the tracked Markdown files (IMP-23.4).
//
//   node scripts/check-doc-links.mjs          (or: pnpm docs:links)
//
// A link passes when its target is a TRACKED file or folder (so a link to a file that is git-excluded
// fails, as it would on GitHub) and, when it has a #fragment and the target is a Markdown file, when
// the fragment matches a heading of that file under GitHub's slug rule. External links (http, mailto)
// are not fetched, and links inside code blocks or code spans are ignored. Node built-ins only.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const posix = path.posix;

/** Replaces fenced code blocks and inline code by blanks, keeping every line (and so every line number). */
export function stripCode(markdown) {
  return stripFences(markdown)
    .split('\n')
    .map((line) => line.replace(/(`+)(?:(?!\1)[^])*?\1/g, ''))
    .join('\n');
}

/** GitHub's heading anchor: lower case, markup and punctuation dropped, spaces to hyphens. */
export function slug(heading) {
  return heading
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** The anchors a Markdown file offers; a repeated heading gets -1, -2, … as on GitHub. */
export function anchors(markdown) {
  const seen = new Map();
  const result = new Set();
  for (const line of stripFences(markdown).split('\n')) {
    const m = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    result.add(n === 0 ? base : `${base}-${n}`);
  }
  return result;
}

function stripFences(markdown) {
  let fence = null;
  return markdown
    .split('\n')
    .map((line) => {
      const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
        return '';
      }
      if (m) {
        fence = m[1];
        return '';
      }
      return line;
    })
    .join('\n');
}

/**
 * @param {Map<string, string>} files  tracked Markdown files: repo-relative POSIX path -> content
 * @param {Set<string>} tracked        every tracked path (files, not folders)
 * @returns {{ checked: number, failures: string[] }}
 */
export function checkLinks(files, tracked) {
  const anchorCache = new Map();
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchors(files.get(file)));
    return anchorCache.get(file);
  };
  const isFolder = (p) => [...tracked].some((t) => t.startsWith(`${p}/`));
  const failures = [];
  let checked = 0;

  for (const [file, content] of files) {
    stripCode(content)
      .split('\n')
      .forEach((line, index) => {
        for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
          const target = m[1];
          if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:, …
          checked += 1;
          const fail = (reason) => failures.push(`${file}:${index + 1}: ${target} (${reason})`);

          const hash = target.indexOf('#');
          const rawPath = hash === -1 ? target : target.slice(0, hash);
          const fragment = hash === -1 ? '' : target.slice(hash + 1);

          let resolved;
          try {
            const decoded = decodeURI(rawPath);
            resolved = decoded.startsWith('/')
              ? posix.normalize(decoded.slice(1))
              : posix.normalize(posix.join(posix.dirname(file), decoded));
          } catch {
            fail('not a valid URL');
            continue;
          }
          if (rawPath === '') resolved = file;
          resolved = resolved.replace(/\/$/, '');
          if (resolved === '.' || resolved === '') continue; // the repository root
          if (resolved.startsWith('..')) {
            fail('outside the repository');
            continue;
          }

          const isFile = tracked.has(resolved);
          if (!isFile && !isFolder(resolved)) {
            fail('no such tracked file or folder');
            continue;
          }
          if (fragment && isFile && files.has(resolved)) {
            const wanted = decodeURIComponent(fragment).toLowerCase();
            if (!anchorsOf(resolved).has(wanted)) fail(`no heading "#${fragment}" in ${resolved}`);
          }
        }
      });
  }
  return { checked, failures };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const list = (...args) =>
    execFileSync('git', ['ls-files', '-z', ...args], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  const tracked = new Set(list());
  const files = new Map(
    list('*.md')
      .filter((f) => !f.startsWith('.claude/'))
      .map((f) => [f, readFileSync(path.join(root, f), 'utf8')]),
  );
  const { checked, failures } = checkLinks(files, tracked);
  for (const f of failures) console.error(f);
  console.log(
    `${checked} relative links checked in ${files.size} Markdown files, ${failures.length} broken`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  blend,
  checkPairs,
  contrastRatio,
  formatReport,
  PAIRS,
  parseColor,
  parseTokens,
  resolveToken,
} from './contrast-lib.ts';

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

describe('parseColor', () => {
  it('reads hex in its four lengths', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#08131d')).toEqual({ r: 8, g: 19, b: 29, a: 1 });
    expect(parseColor('#0000')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('#ff000080')?.a).toBeCloseTo(0.502, 2);
  });

  it('reads rgb() and rgba(), with commas or spaces', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColor('rgba(149, 155, 255, 0.12)')).toEqual({ r: 149, g: 155, b: 255, a: 0.12 });
    expect(parseColor('rgb(1 2 3 / 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
  });

  it('gives up on anything else', () => {
    for (const text of ['red', 'var(--x)', '#12', '#12345', 'rgb(a, b, c)', '']) {
      expect(parseColor(text)).toBeUndefined();
    }
  });
});

describe('contrast arithmetic', () => {
  it('puts black on white at 21:1 and a colour on itself at 1:1', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
  });

  it('matches a published pair: #767676 on white is 4.54:1', () => {
    expect(contrastRatio(parseColor('#767676')!, WHITE)).toBeCloseTo(4.54, 2);
  });

  it('blends a translucent colour over an opaque surface', () => {
    const blended = blend({ r: 255, g: 0, b: 0, a: 0.5 }, WHITE);
    expect(blended).toEqual({ r: 255, g: 127.5, b: 127.5, a: 1 });
    expect(blend({ r: 10, g: 20, b: 30, a: 1 }, WHITE)).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });
});

describe('parseTokens and resolveToken', () => {
  it('keeps the last declaration of a name, across :root blocks, and ignores comments', () => {
    const tokens = parseTokens(`
      /* :root { --ghost: #123456; } */
      :root { --flow: #111111; --a: #000000; }
      body { --not-root: #ffffff; }
      :root { --flow: #222222; }
    `);
    expect(tokens.get('--flow')).toBe('#222222');
    expect(tokens.get('--a')).toBe('#000000');
    expect(tokens.has('--ghost')).toBe(false);
    expect(tokens.has('--not-root')).toBe(false);
  });

  it('follows var() to the end and reports a missing token or a loop', () => {
    const tokens = parseTokens(
      ':root { --a: var(--b); --b: var(--c); --c: #abcdef; --x: var(--y); --y: var(--x); }',
    );
    expect(resolveToken(tokens, '--a')).toBe('#abcdef');
    expect(() => resolveToken(tokens, '--nope')).toThrow(/not defined/);
    expect(() => resolveToken(tokens, '--x')).toThrow(/refers to itself/);
  });
});

describe('checkPairs', () => {
  const tokens = parseTokens(`:root {
    --bg: #000000; --ok: #ffffff; --dim: #333333;
    --tint: rgba(255, 255, 255, 0.1); --alias: var(--ok);
  }`);

  it('passes a pair at its minimum and fails one below it, naming both colours', () => {
    const { results } = checkPairs(tokens, [
      { fg: '--ok', bg: '--bg', min: 4.5 },
      { fg: '--dim', bg: '--bg', min: 4.5 },
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(formatReport({ results, errors: [] })).toMatch(/FAIL.*--dim on --bg/);
  });

  it('follows an alias and blends a translucent background over its surface', () => {
    const { results, errors } = checkPairs(tokens, [
      { fg: '--alias', bg: '--tint', over: '--bg', min: 4.5 },
    ]);
    expect(errors).toEqual([]);
    expect(results[0]?.ratio).toBeGreaterThan(10);
  });

  it('reports a missing token, a malformed colour and a translucent background with no surface', () => {
    const bad = parseTokens(':root { --bg: #000000; --word: red; --tint: rgba(1, 2, 3, 0.1); }');
    const { results, errors } = checkPairs(bad, [
      { fg: '--missing', bg: '--bg', min: 4.5 },
      { fg: '--word', bg: '--bg', min: 4.5 },
      { fg: '--bg', bg: '--tint', min: 4.5 },
    ]);
    expect(results).toEqual([]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/--missing/);
    expect(errors[1]).toMatch(/not a colour/);
    expect(errors[2]).toMatch(/no surface/);
  });
});

describe('the tokens that ship', () => {
  const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const report = checkPairs(parseTokens(css));

  it('can be measured in full', () => {
    expect(report.errors).toEqual([]);
    expect(report.results).toHaveLength(PAIRS.length);
  });

  it('meets every minimum, including text on a 12 % neon tint and the neon colours on surface-2', () => {
    const failing = report.results
      .filter((r) => !r.ok)
      .map((r) => `${r.pair.fg} on ${r.pair.bg} ${r.ratio.toFixed(2)}`);
    expect(failing).toEqual([]);
  });

  it('checks the neon colours on surface-2 and text on the tints', () => {
    const has = (fg: string, bg: string, over?: string) =>
      PAIRS.some((p) => p.fg === fg && p.bg === bg && p.over === over && p.min >= 4.5);
    for (const fg of ['--accent', '--success', '--warning', '--danger', '--info']) {
      expect(has(fg, '--surface-2')).toBe(true);
    }
    for (const tint of ['--tint-ok', '--tint-warn', '--tint-bad', '--tint-info', '--tint-accent']) {
      expect(has('--text-primary', tint, '--surface-1')).toBe(true);
    }
  });

  it('keeps tertiary text off surface-3, as frame 00 says', () => {
    expect(PAIRS.some((p) => p.fg === '--text-tertiary' && p.bg === '--surface-3')).toBe(false);
  });

  it('declares the 12 % tints at 0.12', () => {
    const tokens = parseTokens(css);
    for (const name of ['--tint-ok', '--tint-warn', '--tint-bad', '--tint-info', '--tint-accent']) {
      expect(parseColor(resolveToken(tokens, name))?.a).toBe(0.12);
    }
  });
});

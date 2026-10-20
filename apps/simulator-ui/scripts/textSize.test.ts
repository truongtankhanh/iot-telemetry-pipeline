// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTokens } from './contrast-lib.ts';
import { findSmallText, MIN_TEXT_PX } from './textSize.ts';

describe('findSmallText', () => {
  it('reports a font-size below 13 px, with its selector', () => {
    expect(findSmallText('.hint { font-size: 12px; color: red; }')).toEqual([
      { selector: '.hint', declaration: 'font-size: 12px', px: 12 },
    ]);
  });

  it('accepts 13 px and above', () => {
    expect(
      findSmallText('.a { font-size: 13px } .b { font-size: 14px } .c { font-size: 2rem }'),
    ).toEqual([]);
    expect(MIN_TEXT_PX).toBe(13);
  });

  it('measures rem and em against 14 px, so 0.9rem (12.6) is reported and 1rem is not', () => {
    const found = findSmallText(
      '.a { font-size: 0.9rem } .b { font-size: 1rem } .c { font-size: 0.8em }',
    );
    expect(found.map((f) => f.selector)).toEqual(['.a', '.c']);
  });

  it('reads the size in a font shorthand', () => {
    expect(
      findSmallText('.a { font: 500 12px/1.4 var(--font-ui) } .b { font: 600 14px/1 sans-serif }'),
    ).toHaveLength(1);
  });

  it('follows a token', () => {
    const tokens = parseTokens(':root { --tiny: 11px; --fine: 14px; }');
    const found = findSmallText(
      '.a { font-size: var(--tiny) } .b { font-size: var(--fine) }',
      tokens,
    );
    expect(found.map((f) => f.selector)).toEqual(['.a']);
    expect(found[0]?.declaration).toBe('font-size: 11px');
  });

  it('reads rules inside @media, and ignores comments', () => {
    const css = `
      /* .ghost { font-size: 8px } */
      @media (min-width: 1600px) { .wide { font-size: 12px; } }
    `;
    expect(findSmallText(css).map((f) => f.selector)).toEqual(['.wide']);
  });

  it('does not read what it cannot know: keywords, percentages, calc, other properties', () => {
    const css =
      '.a { font-size: smaller } .b { font-size: 80% } .c { font-size: calc(10px + 1px) } .d { line-height: 12px; width: 5px }';
    expect(findSmallText(css)).toEqual([]);
  });

  it('keeps going over an unknown token', () => {
    expect(findSmallText('.a { font-size: var(--missing) }')).toEqual([]);
  });
});

describe('the stylesheets that ship', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(src, name));
  const tokens = parseTokens(readFileSync(join(src, 'styles', 'tokens.css'), 'utf8'));

  it('finds the token file and the base styles', () => {
    expect(files.some((f) => f.endsWith('tokens.css'))).toBe(true);
    expect(files.some((f) => f.endsWith('base.css'))).toBe(true);
  });

  it('has no text below 13 px in any of them', () => {
    const small = files.flatMap((file) =>
      findSmallText(readFileSync(file, 'utf8'), tokens).map(
        (f) => `${file.replace(src, 'src/')}: ${f.selector} { ${f.declaration} }`,
      ),
    );
    expect(small).toEqual([]);
  });
});

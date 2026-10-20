/**
 * Finds text smaller than Studio's minimum in a stylesheet: the smallest text is 13 px (frame 00, and
 * convention 4 of the implementation order). A `font-size` or the size in a `font` shorthand is read
 * when it is a length in `px`, `rem` or `em`, or a `var(--token)` that resolves to one. `rem` and `em`
 * are measured against 14 px, the size of body text: a deliberate over-estimate of the smaller, so a
 * doubtful value is reported rather than let through. `calc()`, `clamp()`, percentages and keywords
 * are not read.
 */
import { resolveToken } from './contrast-lib.ts';

export const MIN_TEXT_PX = 13;
const BASE_PX = 14;

export interface SmallText {
  selector: string;
  declaration: string;
  px: number;
}

function toPx(value: string): number | undefined {
  if (/\b(calc|clamp|min|max)\(/.test(value)) return undefined;
  const match = /(\d*\.?\d+)(px|rem|em)\b/.exec(value);
  if (match === null) return undefined;
  const size = Number.parseFloat(match[1] as string);
  return match[2] === 'px' ? size : size * BASE_PX;
}

function resolveVars(value: string, tokens: Map<string, string>): string {
  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (whole, name: string) => {
    try {
      return resolveToken(tokens, name);
    } catch {
      return whole;
    }
  });
}

export function findSmallText(
  css: string,
  tokens: Map<string, string> = new Map(),
  minPx: number = MIN_TEXT_PX,
): SmallText[] {
  const found: SmallText[] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (rule[1] as string).trim().replace(/\s+/g, ' ');
    for (const declaration of (rule[2] as string).split(';')) {
      const colon = declaration.indexOf(':');
      if (colon === -1) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      if (property !== 'font-size' && property !== 'font') continue;
      const value = resolveVars(declaration.slice(colon + 1).trim(), tokens);
      const px = toPx(value);
      if (px !== undefined && px > 0 && px < minPx) {
        found.push({ selector, declaration: `${property}: ${value}`, px });
      }
    }
  }
  return found;
}

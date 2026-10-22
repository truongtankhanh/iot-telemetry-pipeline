/**
 * The arithmetic and the list of colour pairs behind `scripts/contrast.ts` (run by `pnpm lint`). Plain
 * TypeScript with no dependency, so Node 24 runs it by stripping the types and a test imports it.
 *
 * Same idea as the command center console's `scripts/contrast.ts` (another repository, not checked
 * here): the tokens are read from the stylesheet that ships, every pair that is used for text or for a
 * boundary that carries meaning is measured with the WCAG 2.x relative-luminance formula, and a pair
 * below its minimum fails. A colour with transparency is blended over the surface it sits on first.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** WCAG 1.4.3, normal text. */
export const TEXT = 4.5;
/** WCAG 1.4.11, a boundary or graphic that carries meaning. */
export const UI = 3;

/** Reads `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. */
export function parseColor(text: string): Rgba | undefined {
  const value = text.trim().toLowerCase();

  const hex = /^#([0-9a-f]+)$/.exec(value)?.[1];
  if (hex !== undefined) {
    const full =
      hex.length === 3 || hex.length === 4
        ? [...hex].map((c) => c + c).join('')
        : hex.length === 6 || hex.length === 8
          ? hex
          : undefined;
    if (full === undefined) return undefined;
    const byte = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(value)?.[1];
  if (fn !== undefined) {
    const parts = fn.split(/[\s,/]+/).filter((part) => part !== '');
    const [r, g, b, alpha] = parts.map((part) =>
      part.endsWith('%') ? Number.parseFloat(part) / 100 : Number.parseFloat(part),
    );
    if (r === undefined || g === undefined || b === undefined) return undefined;
    if ([r, g, b].some((n) => Number.isNaN(n))) return undefined;
    const a = alpha === undefined || Number.isNaN(alpha) ? 1 : alpha;
    return { r, g, b, a };
  }

  return undefined;
}

/** `fg` over an opaque `bg`. */
export function blend(fg: Rgba, bg: Rgba): Rgba {
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio of two opaque colours, 1 to 21. */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The custom properties declared in the `:root` blocks of a stylesheet. A name declared twice keeps its
 * last value, which is the one the browser draws. Comments are ignored.
 */
export function parseTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of withoutComments.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const declaration of (block[1] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens.set(declaration[1] as string, (declaration[2] as string).trim());
    }
  }
  return tokens;
}

/** The value of a token with `var(--other)` followed to the end. */
export function resolveToken(tokens: Map<string, string>, name: string): string {
  let current = name;
  for (let depth = 0; depth < 10; depth++) {
    const value = tokens.get(current);
    if (value === undefined) throw new Error(`token ${current} is not defined`);
    const next = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)?.[1];
    if (next === undefined) return value;
    current = next;
  }
  throw new Error(`token ${name} refers to itself`);
}

function colorOf(tokens: Map<string, string>, name: string): Rgba {
  const value = resolveToken(tokens, name);
  const color = parseColor(value);
  if (color === undefined) throw new Error(`token ${name} is "${value}", which is not a colour`);
  return color;
}

export interface Pair {
  fg: string;
  bg: string;
  min: number;
  /** The opaque surface under a translucent `bg` (a 12 % tint). */
  over?: string;
}

export interface PairResult {
  pair: Pair;
  ratio: number;
  ok: boolean;
}

export function measure(tokens: Map<string, string>, pair: Pair): number {
  let bg = colorOf(tokens, pair.bg);
  if (bg.a < 1) {
    if (pair.over === undefined)
      throw new Error(`${pair.bg} is translucent and the pair has no surface under it`);
    bg = blend(bg, colorOf(tokens, pair.over));
  }
  const fg = colorOf(tokens, pair.fg);
  return contrastRatio(fg.a < 1 ? blend(fg, bg) : fg, bg);
}

const cross = (fgs: string[], bgs: string[], min: number): Pair[] =>
  fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min })));

const NEON: [fg: string, tint: string][] = [
  ['--success', '--tint-ok'],
  ['--warning', '--tint-warn'],
  ['--danger', '--tint-bad'],
  ['--info', '--tint-info'],
  ['--accent', '--tint-accent'],
];

/** Which token sits on which surface: the rules of frame 00 of docs/design/simulator/mockups. */
export const PAIRS: Pair[] = [
  ...cross(
    ['--text-primary', '--text-secondary'],
    ['--surface-0', '--surface-1', '--surface-2', '--surface-3'],
    TEXT,
  ),
  // Tertiary text stays off surface-3 (4.1:1 there): menus and toasts use primary and secondary only.
  ...cross(['--text-tertiary'], ['--surface-0', '--surface-1', '--surface-2'], TEXT),
  // The electric colours as text on the three surfaces the cards, rail and selection use.
  ...cross(
    ['--accent', '--success', '--warning', '--danger', '--info', '--flow', '--status-resolved'],
    ['--surface-0', '--surface-1', '--surface-2'],
    TEXT,
  ),
  ...cross(
    ['--sev-critical', '--sev-high', '--sev-medium', '--sev-low'],
    ['--surface-0', '--surface-1', '--surface-2'],
    TEXT,
  ),
  // A neon colour as text on its own 12 % tint over surface-1, and primary text on that tint.
  ...NEON.flatMap(([fg, tint]) => [
    { fg, bg: tint, over: '--surface-1', min: TEXT },
    { fg: '--text-primary', bg: tint, over: '--surface-1', min: TEXT },
  ]),
  { fg: '--accent-ink', bg: '--accent', min: TEXT },
  // The Lab's playhead pill: the time in dark ink on the flow colour.
  { fg: '--accent-ink', bg: '--flow', min: TEXT },
  // Boundaries that carry meaning (an input, a selected option).
  ...cross(['--border-strong'], ['--surface-0', '--surface-1'], UI),
];

export interface Report {
  results: PairResult[];
  /** A pair that could not be measured (a missing or malformed token); always a failure. */
  errors: string[];
}

export function checkPairs(tokens: Map<string, string>, pairs: Pair[] = PAIRS): Report {
  const results: PairResult[] = [];
  const errors: string[] = [];
  for (const pair of pairs) {
    try {
      const ratio = measure(tokens, pair);
      results.push({ pair, ratio, ok: ratio >= pair.min });
    } catch (error) {
      errors.push(
        `${pair.fg} on ${pair.bg}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { results, errors };
}

const label = ({ fg, bg, over }: Pair) => `${fg} on ${bg}${over ? ` over ${over}` : ''}`;

export function formatReport({ results, errors }: Report): string {
  const lines = results.map(
    ({ pair, ratio, ok }) =>
      `${ok ? 'ok  ' : 'FAIL'} ${ratio.toFixed(2).padStart(5)}  min ${pair.min}  ${label(pair)}`,
  );
  return [...lines, ...errors.map((e) => `ERR   ${e}`)].join('\n');
}

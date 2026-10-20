import { GROUP_ORDER, type PaletteGroup, type PaletteItem } from './paletteItems';

/** `d:` devices, `a:` alerts, `s:` scenarios, `>` actions: a prefix narrows the search to one group. */
const PREFIXES: [string, PaletteGroup][] = [
  ['d:', 'devices'],
  ['a:', 'alerts'],
  ['s:', 'scenarios'],
  ['>', 'actions'],
];

export const GROUP_LIMIT = 5;

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Lower case with the accents taken off, so "cafe" finds "Café". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function parseQuery(raw: string): { group: PaletteGroup | null; text: string } {
  const trimmed = raw.trimStart();
  for (const [prefix, group] of PREFIXES) {
    if (trimmed.startsWith(prefix)) return { group, text: trimmed.slice(prefix.length).trim() };
  }
  return { group: null, text: trimmed.trim() };
}

const words = (text: string) => text.split(/[^a-z0-9]+/).filter((word) => word !== '');

/**
 * How well an item matches, 0 for not at all: the whole label (100), the start of the label (80), the start
 * of a word of the label (70), a keyword (90 whole, 60 start, 50 start of a word), then anywhere in the
 * label (40) or in a keyword or the detail (30).
 */
export function score(item: PaletteItem, query: string): number {
  const label = normalize(item.label);
  const keywords = item.keywords.map(normalize).filter((k) => k !== '');
  if (label === query) return 100;
  if (keywords.includes(query)) return 90;
  if (label.startsWith(query)) return 80;
  if (words(label).some((word) => word.startsWith(query))) return 70;
  if (keywords.some((k) => k.startsWith(query))) return 60;
  if (keywords.some((k) => words(k).some((word) => word.startsWith(query)))) return 50;
  if (label.includes(query)) return 40;
  if (keywords.some((k) => k.includes(query)) || normalize(item.detail ?? '').includes(query))
    return 30;
  return 0;
}

export interface GroupMatches {
  group: PaletteGroup;
  /** At most five unless the group was expanded. */
  items: PaletteItem[];
  /** How many more matched and are behind "Show all". */
  hidden: number;
}

export interface PaletteMatches {
  /** The group a prefix narrowed the search to, or `null`. */
  prefix: PaletteGroup | null;
  groups: GroupMatches[];
  total: number;
}

/**
 * The palette's results for a query. Results are ranked by how well they match, then, among alerts, an
 * open one before a cleared one and a more severe one before a milder one. With nothing typed the pages
 * are listed (and, after a prefix, the whole group). Only the first five of a group show; the rest sit
 * behind "Show all".
 */
export function matchPalette(
  items: PaletteItem[],
  raw: string,
  options: { expanded?: ReadonlySet<PaletteGroup>; limit?: number } = {},
): PaletteMatches {
  const { group: prefix, text } = parseQuery(raw);
  const limit = options.limit ?? GROUP_LIMIT;
  const query = normalize(text);

  const inScope = items.filter((candidate) => (prefix ? candidate.group === prefix : true));
  const ranked =
    query === '' ? inScope.filter((c) => prefix !== null || c.group === 'pages') : inScope;

  const scored = ranked
    .map((candidate, index) => ({
      candidate,
      index,
      score: query === '' ? 1 : score(candidate, query),
    }))
    .filter((entry) => entry.score > 0);

  const groups: GroupMatches[] = [];
  for (const group of GROUP_ORDER) {
    const inGroup = scored
      .filter((entry) => entry.candidate.group === group)
      .sort(
        (a, b) => b.score - a.score || alertOrder(a.candidate, b.candidate) || a.index - b.index,
      )
      .map((entry) => entry.candidate);
    if (inGroup.length === 0) continue;
    const shown = options.expanded?.has(group) ? inGroup : inGroup.slice(0, limit);
    groups.push({ group, items: shown, hidden: inGroup.length - shown.length });
  }
  return { prefix, groups, total: scored.length };
}

/** Among alerts of equal match, open before cleared, then by severity. Zero for anything else. */
function alertOrder(a: PaletteItem, b: PaletteItem): number {
  if (a.group !== 'alerts' || b.group !== 'alerts') return 0;
  if (a.open !== b.open) return a.open ? -1 : 1;
  return (SEVERITY_RANK[a.severity ?? ''] ?? 9) - (SEVERITY_RANK[b.severity ?? ''] ?? 9);
}

/** The visible results in the order the keyboard moves through them. */
export const visibleItems = (matches: PaletteMatches): PaletteItem[] =>
  matches.groups.flatMap((g) => g.items);

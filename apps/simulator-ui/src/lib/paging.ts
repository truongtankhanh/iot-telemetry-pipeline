/** The arithmetic of a numbered pager, kept out of the component so it can be tested alone. */

export const PAGE_SIZES = [10, 25, 50, 100] as const;

export const pageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

/** A page number inside 1..count; anything that is not a whole number is the first page. */
export function clampPage(page: number, count: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), count);
}

/** The rows a page shows, 1-based and inclusive: "26 to 50 of 312". `from` and `to` are 0 when there are none. */
export function rowRange(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(total, page * pageSize) };
}

export type PageItem = number | 'gap';

/**
 * The page buttons: always the first and the last page and the ones next to the current page, with a gap
 * where pages are left out (`1 … 12 13 14 … 50`). Up to seven pages are all shown.
 */
export function pageWindow(page: number, count: number): PageItem[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const wanted = new Set([1, count, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => wanted.add(n));
  if (page >= count - 2) [count - 3, count - 2, count - 1].forEach((n) => wanted.add(n));
  const pages = [...wanted].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const items: PageItem[] = [];
  pages.forEach((n, i) => {
    const before = pages[i - 1];
    if (before !== undefined && n - before > 1) items.push(n - before === 2 ? n - 1 : 'gap');
    items.push(n);
  });
  return items;
}

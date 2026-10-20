import { describe, expect, it } from 'vitest';
import { clampPage, pageCount, pageWindow, rowRange } from './paging';

describe('pageCount', () => {
  it('rounds up, and is never below one page', () => {
    expect(pageCount(312, 25)).toBe(13);
    expect(pageCount(300, 25)).toBe(12);
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(5, 0)).toBe(5);
  });
});

describe('rowRange', () => {
  it('counts rows from 1, inclusive', () => {
    expect(rowRange(1, 25, 312)).toEqual({ from: 1, to: 25 });
    expect(rowRange(2, 25, 312)).toEqual({ from: 26, to: 50 });
    expect(rowRange(13, 25, 312)).toEqual({ from: 301, to: 312 });
  });

  it('is empty when there are no rows', () => {
    expect(rowRange(1, 25, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('clampPage', () => {
  it('keeps a page inside the range, and takes anything odd to the first page', () => {
    expect(clampPage(5, 13)).toBe(5);
    expect(clampPage(0, 13)).toBe(1);
    expect(clampPage(99, 13)).toBe(13);
    expect(clampPage(3.9, 13)).toBe(3);
    expect(clampPage(Number.NaN, 13)).toBe(1);
  });
});

describe('pageWindow', () => {
  it('shows every page up to seven', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the first, the last and the neighbours of the current page, with gaps', () => {
    expect(pageWindow(1, 13)).toEqual([1, 2, 3, 4, 'gap', 13]);
    expect(pageWindow(7, 13)).toEqual([1, 'gap', 6, 7, 8, 'gap', 13]);
    expect(pageWindow(13, 13)).toEqual([1, 'gap', 10, 11, 12, 13]);
  });

  it('fills a gap of one page with the page instead of a gap', () => {
    expect(pageWindow(5, 13)).toEqual([1, 'gap', 4, 5, 6, 'gap', 13]);
    expect(pageWindow(4, 13)).toEqual([1, 2, 3, 4, 5, 'gap', 13]);
  });

  it('never repeats a page or leaves the range', () => {
    for (let count = 1; count <= 40; count++) {
      for (let page = 1; page <= count; page++) {
        const numbers = pageWindow(page, count).filter((i): i is number => i !== 'gap');
        expect(new Set(numbers).size).toBe(numbers.length);
        expect(numbers.every((n) => n >= 1 && n <= count)).toBe(true);
        expect(numbers).toContain(page);
        expect(numbers).toContain(1);
        expect(numbers).toContain(count);
      }
    }
  });
});

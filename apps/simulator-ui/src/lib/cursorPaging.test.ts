import { describe, expect, it } from 'vitest';
import {
  canGoNewer,
  canGoOlder,
  cursorOf,
  depthOf,
  goNewer,
  goOlder,
  NEWEST_PAGE,
  positionText,
} from './cursorPaging';

describe('the cursors Studio was given', () => {
  it('starts on the newest page, which has no cursor and nothing newer', () => {
    expect(cursorOf(NEWEST_PAGE)).toBeUndefined();
    expect(depthOf(NEWEST_PAGE)).toBe(0);
    expect(canGoNewer(NEWEST_PAGE)).toBe(false);
  });

  it('goes older with the cursor the page came with, and back with the one before', () => {
    const second = goOlder(NEWEST_PAGE, 'c1');
    const third = goOlder(second, 'c2');
    expect(cursorOf(second)).toBe('c1');
    expect(cursorOf(third)).toBe('c2');
    expect(depthOf(third)).toBe(2);

    expect(goNewer(third)).toEqual(second);
    expect(cursorOf(goNewer(second))).toBeUndefined();
  });

  it('does not go older without a cursor, and does not go newer than the newest', () => {
    expect(canGoOlder(null)).toBe(false);
    expect(canGoOlder('')).toBe(false);
    expect(canGoOlder('c1')).toBe(true);
    expect(goOlder(NEWEST_PAGE, null)).toBe(NEWEST_PAGE);
    expect(goNewer(NEWEST_PAGE)).toBe(NEWEST_PAGE);
  });

  it('never changes the stack it was given', () => {
    const base = goOlder(NEWEST_PAGE, 'c1');
    goOlder(base, 'c2');
    goNewer(base);
    expect(base).toEqual(['c1']);
    expect(NEWEST_PAGE).toEqual([]);
  });

  it('hands a cursor back exactly as it was received', () => {
    const odd = 'eyJ0IjoiMjAyNi0xMC0xNlQwODowMDoyNi4wMDBaIiwiaWQiOiI3In0=+/';
    expect(cursorOf(goOlder(NEWEST_PAGE, odd))).toBe(odd);
  });
});

describe('the line that says where the page is', () => {
  it('counts what is shown and never numbers the page', () => {
    expect(positionText(NEWEST_PAGE, 5)).toBe('Showing 5 alerts · newest first');
    expect(positionText(NEWEST_PAGE, 1)).toBe('Showing 1 alert · newest first');
    expect(positionText(goOlder(NEWEST_PAGE, 'c1'), 5)).toBe(
      'Showing 5 alerts · older alerts, newest first',
    );
    expect(positionText(goOlder(NEWEST_PAGE, 'c1'), 5)).not.toMatch(/page \d|of \d/i);
  });

  it('says so when a page is empty', () => {
    expect(positionText(NEWEST_PAGE, 0)).toBe('No alerts on this page');
  });
});

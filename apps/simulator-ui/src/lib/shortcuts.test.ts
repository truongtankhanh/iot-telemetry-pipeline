import { describe, expect, it } from 'vitest';
import { appRoutes } from './routes';
import { createShortcuts, isEditableTarget, type KeyEventLike } from './shortcuts';

const routes = appRoutes({ foundations: true });
const press = (key: string, extra: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: { tagName: 'BODY' },
  ...extra,
});

function setup() {
  let time = 0;
  const handle = createShortcuts(routes, { now: () => time });
  return { handle, at: (ms: number) => void (time = ms) };
}

describe('opening the palette', () => {
  it('opens on ⌘ K and Ctrl K, in any case', () => {
    const { handle } = setup();
    expect(handle(press('k', { metaKey: true }))).toEqual({ type: 'open-palette' });
    expect(handle(press('K', { ctrlKey: true }))).toEqual({ type: 'open-palette' });
  });

  it('opens on ⌘ K from inside a field, but not on /', () => {
    const { handle } = setup();
    const field = { tagName: 'INPUT' };
    expect(handle(press('k', { metaKey: true, target: field }))).toEqual({ type: 'open-palette' });
    expect(handle(press('/', { target: field }))).toBeNull();
  });

  it('opens on / outside a field', () => {
    expect(setup().handle(press('/'))).toEqual({ type: 'open-palette' });
  });

  it('leaves ⌘ Alt K and Alt K to the browser', () => {
    const { handle } = setup();
    expect(handle(press('k', { metaKey: true, altKey: true }))).toBeNull();
    expect(handle(press('k', { altKey: true }))).toBeNull();
  });
});

describe('go to', () => {
  it('goes to a page on g then its letter', () => {
    const { handle, at } = setup();
    expect(handle(press('g'))).toBeNull();
    at(400);
    expect(handle(press('f'))).toEqual({ type: 'go', path: '/fleet' });
  });

  it('forgets a g after a second', () => {
    const { handle, at } = setup();
    handle(press('g'));
    at(1500);
    expect(handle(press('f'))).toBeNull();
  });

  it('forgets a g when the next key is not a page, and does not carry it over', () => {
    const { handle } = setup();
    handle(press('g'));
    expect(handle(press('x'))).toBeNull();
    expect(handle(press('f'))).toBeNull(); // the g was used up by x
  });

  it('ignores g and the letter in a field', () => {
    const { handle } = setup();
    const field = { tagName: 'TEXTAREA' };
    handle(press('g', { target: field }));
    expect(handle(press('f'))).toBeNull();
  });

  it('does not go to a page with a modifier held', () => {
    const { handle } = setup();
    handle(press('g'));
    expect(handle(press('f', { ctrlKey: true }))).toBeNull();
  });

  it('can go to a page, then to another', () => {
    const { handle } = setup();
    handle(press('g'));
    expect(handle(press('o'))).toEqual({ type: 'go', path: '/' });
    handle(press('g'));
    expect(handle(press('a'))).toEqual({ type: 'go', path: '/alerts' });
  });

  it("ignores keys that are not Studio's", () => {
    const { handle } = setup();
    for (const key of ['a', 'Enter', 'Escape', 'ArrowDown', 'Tab'])
      expect(handle(press(key))).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('is true for inputs, textareas, selects and editable elements', () => {
    for (const tagName of ['INPUT', 'textarea', 'Select'])
      expect(isEditableTarget({ tagName })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for anything else, including nothing', () => {
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget('x')).toBe(false);
    expect(isEditableTarget({})).toBe(false);
  });
});

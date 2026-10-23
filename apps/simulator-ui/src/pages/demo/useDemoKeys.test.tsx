import { act, fireEvent, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore } from '../../state/store';
import { type PresenterHandlers, useDemoKeys } from './useDemoKeys';

function setup(enabled = true) {
  const handlers = {
    next: vi.fn(),
    back: vi.fn(),
    exit: vi.fn(),
    restart: vi.fn(),
    togglePause: vi.fn(),
    toggleNotes: vi.fn(),
  } satisfies PresenterHandlers;
  const store = createStudioStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store}>{children}</StudioProvider>
  );
  const view = renderHook(({ on }) => useDemoKeys(on, handlers), {
    wrapper,
    initialProps: { on: enabled },
  });
  return { handlers, store, ...view };
}

const press = (key: string, target: Element | Window = document.body, init = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    (target as EventTarget).dispatchEvent(event);
  });
  return event;
};

describe('useDemoKeys', () => {
  it('maps each key of presenter mode to the driver’s command', () => {
    const { handlers } = setup();
    press(' ');
    press('ArrowLeft');
    press('p');
    press('r');
    press('n');
    press('Escape');
    expect(handlers.next).toHaveBeenCalledTimes(1);
    expect(handlers.back).toHaveBeenCalledTimes(1);
    expect(handlers.togglePause).toHaveBeenCalledTimes(1);
    expect(handlers.restart).toHaveBeenCalledTimes(1);
    expect(handlers.toggleNotes).toHaveBeenCalledTimes(1);
    expect(handlers.exit).toHaveBeenCalledTimes(1);
  });

  it('prevents the browser’s default (Space scrolls) for a key that did something, and only then', () => {
    setup();
    expect(press(' ').defaultPrevented).toBe(true);
    expect(press('Escape').defaultPrevented).toBe(true);
    expect(press('a').defaultPrevented).toBe(false);
    expect(press('Tab').defaultPrevented).toBe(false);
  });

  it('listens only while the demo is being presented', () => {
    const { handlers, rerender } = setup(false);
    press(' ');
    press('Escape');
    expect(handlers.next).not.toHaveBeenCalled();
    expect(handlers.exit).not.toHaveBeenCalled();

    rerender({ on: true });
    press(' ');
    expect(handlers.next).toHaveBeenCalledTimes(1);

    rerender({ on: false });
    press(' ');
    expect(handlers.next).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the page goes away', () => {
    const { handlers, unmount } = setup();
    unmount();
    press(' ');
    expect(handlers.next).not.toHaveBeenCalled();
  });

  it('does nothing while the command palette is open (it owns Esc and the keys), and again once it is closed', () => {
    const { handlers, store } = setup();
    act(() => store.getState().setPaletteOpen(true));
    press('Escape');
    press(' ');
    expect(handlers.exit).not.toHaveBeenCalled();
    expect(handlers.next).not.toHaveBeenCalled();
    act(() => store.getState().setPaletteOpen(false));
    press('Escape');
    expect(handlers.exit).toHaveBeenCalledTimes(1);
  });

  it('does nothing while a dialog is open (the replace question), and again once it is closed', () => {
    const { handlers, store } = setup();
    act(() => store.getState().pushModal());
    press('Escape');
    press('r');
    expect(handlers.exit).not.toHaveBeenCalled();
    expect(handlers.restart).not.toHaveBeenCalled();
    act(() => store.getState().popModal());
    press('r');
    expect(handlers.restart).toHaveBeenCalledTimes(1);
  });

  it('ignores a key typed in a field, and with a modifier held', () => {
    const { handlers } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    press(' ', input);
    press('p', input);
    press('Escape', input);
    input.remove();
    press(' ', document.body, { metaKey: true });
    press('r', document.body, { ctrlKey: true });
    press('n', document.body, { altKey: true });
    expect(handlers.next).not.toHaveBeenCalled();
    expect(handlers.togglePause).not.toHaveBeenCalled();
    expect(handlers.exit).not.toHaveBeenCalled();
    expect(handlers.restart).not.toHaveBeenCalled();
    expect(handlers.toggleNotes).not.toHaveBeenCalled();
  });

  it('leaves Space to a focused button, but not the other keys', () => {
    const { handlers } = setup();
    const button = document.createElement('button');
    document.body.append(button);
    const space = press(' ', button);
    press('r', button);
    button.remove();
    expect(handlers.next).not.toHaveBeenCalled();
    expect(space.defaultPrevented).toBe(false);
    expect(handlers.restart).toHaveBeenCalledTimes(1);
  });

  it('calls the newest handlers, not the ones it first heard', () => {
    const store = createStudioStore();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StudioProvider store={store}>{children}</StudioProvider>
    );
    const rest = {
      back: vi.fn(),
      exit: vi.fn(),
      restart: vi.fn(),
      togglePause: vi.fn(),
      toggleNotes: vi.fn(),
    };
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ next }) => useDemoKeys(true, { ...rest, next }), {
      wrapper,
      initialProps: { next: first },
    });
    press(' ');
    rerender({ next: second });
    press(' ');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not listen to a window event of another type', () => {
    const { handlers } = setup();
    fireEvent.keyUp(window, { key: ' ' });
    expect(handlers.next).not.toHaveBeenCalled();
  });
});

import { useEffect, useMemo } from 'react';
import { createPresenterShortcuts, type PresenterAction } from '../../lib/shortcuts';
import { useStudio } from '../../state/studioContext';

/** What a key of presenter mode does; the driver's own commands, so the keys and the buttons are one code path. */
export interface PresenterHandlers {
  next: () => void;
  back: () => void;
  exit: () => void;
  restart: () => void;
  togglePause: () => void;
  toggleNotes: () => void;
}

const HANDLER: Record<PresenterAction, keyof PresenterHandlers> = {
  next: 'next',
  back: 'back',
  exit: 'exit',
  pause: 'togglePause',
  restart: 'restart',
  notes: 'toggleNotes',
};

/**
 * The keyboard of presenter mode (frame 08): `Space` next, `←` back, `P`, `R`, `N`, `Esc`. Listens only while `enabled` (the demo is
 * being presented), and does nothing while the command palette or a dialog is open: they own `Esc` and the keys then, and the page
 * behind them is inert. The browser's default (`Space` scrolls) is prevented only for a key that did something.
 */
export function useDemoKeys(enabled: boolean, handlers: PresenterHandlers): void {
  const paletteOpen = useStudio((state) => state.paletteOpen);
  const modalOpen = useStudio((state) => state.modalCount > 0);
  const handle = useMemo(() => createPresenterShortcuts(), []);
  const { next, back, exit, restart, togglePause, toggleNotes } = handlers;

  useEffect(() => {
    if (!enabled || paletteOpen || modalOpen) return;
    const commands: PresenterHandlers = { next, back, exit, restart, togglePause, toggleNotes };
    const onKeyDown = (event: KeyboardEvent) => {
      const action = handle(event);
      if (action === null) return;
      event.preventDefault();
      commands[HANDLER[action]]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    enabled,
    paletteOpen,
    modalOpen,
    handle,
    next,
    back,
    exit,
    restart,
    togglePause,
    toggleNotes,
  ]);
}

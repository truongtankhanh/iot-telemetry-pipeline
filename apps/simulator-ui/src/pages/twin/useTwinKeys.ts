import { type RefObject, useEffect, useMemo } from 'react';
import type { CameraNudge } from '../../lib/twinCamera';
import { createTwinShortcuts } from '../../lib/twinShortcuts';
import { useStudio } from '../../state/studioContext';

/** What the twin's keys do; the page's own commands, so the keys and the buttons are one code path. */
export interface TwinKeyHandlers {
  /** Climbs one level (device, building, nothing); returns whether there was a level to climb. */
  escape: () => boolean;
  /** Back to the campus: the Campus preset, and no selection. */
  home: () => void;
  nudge: (nudge: CameraNudge) => void;
}

/**
 * The keyboard of the twin: `Esc`, `Home`, and, with focus on the stage, the arrows and `+` / `-`. Listens while the page
 * is mounted, and does nothing while the command palette or a dialog is open: they own `Esc` then, and the page behind
 * them is inert (as `useDemoKeys`). The browser's default is prevented only for a key that did something, so `Esc` with
 * nothing selected is left alone.
 */
export function useTwinKeys(stage: RefObject<HTMLElement | null>, handlers: TwinKeyHandlers): void {
  const paletteOpen = useStudio((state) => state.paletteOpen);
  const modalOpen = useStudio((state) => state.modalCount > 0);
  const handle = useMemo(() => createTwinShortcuts(), []);
  const { escape, home, nudge } = handlers;

  useEffect(() => {
    if (paletteOpen || modalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const action = handle({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        target,
        stageFocused: target instanceof Node && stage.current?.contains(target) === true,
      });
      if (action === null) return;
      if (action.type === 'escape') {
        if (escape()) event.preventDefault();
        return;
      }
      event.preventDefault();
      if (action.type === 'home') home();
      else nudge(action.nudge);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, modalOpen, handle, stage, escape, home, nudge]);
}

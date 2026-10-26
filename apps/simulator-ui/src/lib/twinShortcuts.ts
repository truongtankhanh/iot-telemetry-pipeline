import type { CameraNudge } from './twinCamera';
import { isEditableTarget, type KeyEventLike } from './shortcuts';

/** What a key does on the twin page. */
export type TwinAction =
  { type: 'escape' } | { type: 'home' } | { type: 'nudge'; nudge: CameraNudge };

/** A key press, and whether focus is on the stage (the scene and its controls): only then do arrows and `+` / `-` move the camera. */
export interface TwinKeyEvent extends KeyEventLike {
  stageFocused: boolean;
}

const NUDGES: Record<string, CameraNudge> = {
  ArrowLeft: 'pan-left',
  ArrowRight: 'pan-right',
  ArrowUp: 'pan-up',
  ArrowDown: 'pan-down',
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
  _: 'zoom-out',
};

/**
 * The keyboard of the twin: `Esc` climbs one level (device, building, nothing), `Home` returns to the campus; with focus
 * on the stage the arrows pan and `+` / `-` zoom. Like every single-key shortcut it is ignored in a field (where `Home`
 * and the arrows move the caret) and with a modifier held. None of these keys is a letter, so none of them is the second
 * key of the shell's `g` then a letter. Whether the palette or a dialog is open, and whether `Esc` has anything to climb,
 * is the caller's to say.
 *
 * Returns the action, or `null` when the key is not the twin's.
 */
export function createTwinShortcuts(): (event: TwinKeyEvent) => TwinAction | null {
  return (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) {
      return null;
    }
    if (event.key === 'Escape') return { type: 'escape' };
    if (event.key === 'Home') return { type: 'home' };
    if (!event.stageFocused) return null;
    const nudge = Object.hasOwn(NUDGES, event.key) ? NUDGES[event.key] : undefined;
    return nudge === undefined ? null : { type: 'nudge', nudge };
  };
}

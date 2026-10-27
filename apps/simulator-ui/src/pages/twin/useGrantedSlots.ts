import { useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import type { AnimationSlot, SlotKind } from '../../lib/animationBudget';
import { BudgetContext } from '../../ui/animationBudgetContext';

const NONE: ReadonlySet<string> = new Set();
const SEPARATOR = '\u0000';

const sameMembers = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Asks the screen's animation budget for a slot for each of `ids`, in the order given, and returns the ids that are inside
 * the cap. It is `useAnimationSlot` for a list whose length is not known when the component is written: the twin has an
 * arc for every device, and the 24 glowing lines of the budget are shared with the 2D edges.
 *
 * It lives on the page, not in the scene: the budget is a React context, and whether a context reaches a component inside
 * a `<Canvas>` depends on how React Three Fiber bridges it. The scene is handed plain ids and draws what it is told.
 * Nothing is granted outside a provider, and the slots are given back when the ids change or the page leaves.
 *
 * Pass the ids in the order that matters (the lit arcs first): what asked first keeps moving, and a newcomer waits.
 */
export function useGrantedSlots(kind: SlotKind, ids: readonly string[]): ReadonlySet<string> {
  const budget = useContext(BudgetContext);
  // A string, so a new array with the same ids does not give the slots up and ask for them again.
  const key = ids.join(SEPARATOR);
  const granted = useRef<ReadonlySet<string>>(NONE);

  const subscribe = useCallback(
    (notify: () => void) => {
      if (budget === null || key === '') return () => {};
      const wanted = key.split(SEPARATOR);
      const held: AnimationSlot[] = [];
      const refresh = () => {
        const next = new Set(wanted.filter((_, index) => held[index]?.isGranted() === true));
        if (sameMembers(next, granted.current)) return;
        granted.current = next;
        notify();
      };
      for (let index = 0; index < wanted.length; index += 1)
        held.push(budget.acquire(kind, refresh));
      refresh();
      return () => {
        for (const slot of held) slot.release();
        granted.current = NONE;
      };
    },
    [budget, kind, key],
  );

  return useSyncExternalStore(
    subscribe,
    () => granted.current,
    () => NONE,
  );
}

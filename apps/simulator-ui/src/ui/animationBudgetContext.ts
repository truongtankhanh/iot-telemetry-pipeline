import { createContext, useCallback, useContext, useRef, useSyncExternalStore } from 'react';
import type { AnimationBudget, AnimationSlot, SlotKind } from '../lib/animationBudget';

export const BudgetContext = createContext<AnimationBudget | null>(null);

/**
 * Asks the screen's budget for the right to animate. True while this component is inside the cap, false
 * when it is past it, when `enabled` is false, and always outside a provider: nothing animates unless
 * a budget says it may. The slot is held while the component is mounted and handed on when it leaves.
 */
export function useAnimationSlot(kind: SlotKind, enabled = true): boolean {
  const budget = useContext(BudgetContext);
  const slotRef = useRef<AnimationSlot | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled || budget === null) return () => {};
      const slot = budget.acquire(kind, onChange);
      slotRef.current = slot;
      onChange(); // the grant may have come before the slot was stored
      return () => {
        slot.release();
        slotRef.current = null;
      };
    },
    [budget, kind, enabled],
  );
  const getSnapshot = useCallback(() => slotRef.current?.isGranted() ?? false, []);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

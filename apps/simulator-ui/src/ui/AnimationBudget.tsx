import type { ReactNode } from 'react';
import type { AnimationBudget } from '../lib/animationBudget';
import { BudgetContext } from './animationBudgetContext';

/**
 * Gives a screen one animation budget (12 nodes, 24 lines). Create the budget once per screen with
 * `new AnimationBudget()`; a test passes its own. Components ask it through `useAnimationSlot`.
 */
export function AnimationBudgetProvider({
  budget,
  children,
}: {
  budget: AnimationBudget;
  children: ReactNode;
}) {
  return <BudgetContext.Provider value={budget}>{children}</BudgetContext.Provider>;
}

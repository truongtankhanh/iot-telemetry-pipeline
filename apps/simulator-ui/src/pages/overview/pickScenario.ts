import type { ScenarioItem, ScenarioRunView } from '../../api/types';

/**
 * The scenario the controls show (Q7): the one the address names; else the one that is running (the first, if several);
 * else the first built-in; else the first of the library. `null` for an empty library.
 */
export function pickScenario(
  items: readonly ScenarioItem[],
  runs: readonly ScenarioRunView[],
  wanted: string | null,
): ScenarioItem | null {
  const named = wanted === null ? undefined : items.find((item) => item.name === wanted);
  if (named) return named;
  const running =
    runs[0] === undefined ? undefined : items.find((i) => i.name === runs[0]?.scenario);
  return running ?? items.find((item) => item.source === 'built-in') ?? items[0] ?? null;
}

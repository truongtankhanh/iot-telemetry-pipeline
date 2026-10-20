/**
 * Structural equality for the plain data a node or an edge carries: primitives, arrays and objects. It does not
 * look at functions, dates or classes, because the topology model has none; two things of another kind are not equal.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}

/**
 * Hands the next list of nodes (or edges) to React Flow with the previous object for every one that did not change.
 * The model is rebuilt about once a second, and most of it is the same as a second ago; React Flow re-renders a node
 * whose object changed, so a node whose content is equal must stay the very same object. This is how a state update
 * re-renders only the nodes that changed. When nothing changed the previous array itself comes back, so the graph is
 * not even asked to look.
 */
export function stabilize<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
): T[] {
  const before = new Map(previous.map((item) => [item.id, item]));
  const result = next.map((item) => {
    const old = before.get(item.id);
    return old !== undefined && sameValue(old, item) ? old : item;
  });
  const unchanged =
    result.length === previous.length && result.every((item, i) => item === previous[i]);
  return unchanged ? (previous as T[]) : result;
}

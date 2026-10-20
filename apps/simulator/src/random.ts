/**
 * A small deterministic random source (mulberry32): the same seed always gives the same sequence,
 * so a test or a replayed scenario can reproduce the exact readings. Values are in [0, 1), like
 * `Math.random`. Not for anything that needs unpredictability.
 */
export function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

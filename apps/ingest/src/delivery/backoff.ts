const BASE_MS = 2_000;
const MAX_MS = 10 * 60_000;

/**
 * Exponential backoff with full jitter, capped: 2 s, 4 s, 8 s … up to 10 min. Callers with a
 * different time scale pass their own base and cap.
 */
export function nextDelayMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs = BASE_MS,
  maxMs = MAX_MS,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/** After this many attempts a delivery is marked failed and left for a human. */
export const MAX_ATTEMPTS = 12;

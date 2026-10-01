const BASE_MS = 2_000;
const MAX_MS = 10 * 60_000;

/** Exponential backoff with full jitter, capped: 2 s, 4 s, 8 s … up to 10 min. */
export function nextDelayMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/** After this many attempts a delivery is marked failed and left for a human. */
export const MAX_ATTEMPTS = 12;

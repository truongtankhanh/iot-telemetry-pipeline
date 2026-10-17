/** Polls `read` until `done` accepts its value or `ms` have passed; returns the last value. */
export async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 5000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

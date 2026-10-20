import { describe, expect, it, vi } from 'vitest';
import { runBulk } from './bulk';

describe('runBulk', () => {
  it('runs the items one after another, in order, never two at once', async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const run = async (id: string) => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      order.push(id);
      running -= 1;
    };
    const results = await runBulk(['a', 'b', 'c'], run);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(most).toBe(1);
    expect(results).toEqual([
      { id: 'a', ok: true },
      { id: 'b', ok: true },
      { id: 'c', ok: true },
    ]);
  });

  it('reports progress after each item, with its result', async () => {
    const onProgress = vi.fn();
    await runBulk(['a', 'b'], async () => {}, { onProgress });
    expect(onProgress.mock.calls).toEqual([
      [1, 2, { id: 'a', ok: true }],
      [2, 2, { id: 'b', ok: true }],
    ]);
  });

  it('goes on after a failure and collects its message', async () => {
    const run = async (id: string) => {
      if (id === 'b') throw new Error('Unknown device "b"');
      if (id === 'c') throw 'plain text';
    };
    const results = await runBulk(['a', 'b', 'c', 'd'], run);
    expect(results).toEqual([
      { id: 'a', ok: true },
      { id: 'b', ok: false, error: 'Unknown device "b"' },
      { id: 'c', ok: false, error: 'plain text' },
      { id: 'd', ok: true },
    ]);
  });

  it('stops before the next item when aborted, and leaves the rest out of the results', async () => {
    const controller = new AbortController();
    const run = vi.fn(async (id: string) => {
      if (id === 'b') controller.abort();
    });
    const results = await runBulk(['a', 'b', 'c', 'd'], run, { signal: controller.signal });
    expect(run).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('does nothing for no items, or when already aborted', async () => {
    const run = vi.fn(async () => {});
    expect(await runBulk([], run)).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    expect(await runBulk(['a'], run, { signal: controller.signal })).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});

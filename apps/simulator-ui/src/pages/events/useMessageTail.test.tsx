import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublishedMessage } from '../../api/types';
import { type MessageRow, toRow } from '../../lib/messageRows';
import { type TailInput, useMessageTail } from './useMessageTail';

const row = (id: number): MessageRow => {
  const message: PublishedMessage = {
    id,
    at: '2026-10-19T02:14:31.000Z',
    ackMs: 3,
    deviceId: 'dc-env-01',
    topic: 'campus/BLD-DC/dc-env-01/telemetry',
    payload: JSON.stringify({ seq: id, metrics: { temperature_c: 20 } }),
    seq: id,
    ts: '2026-10-19T02:14:31.000Z',
  };
  return toRow(message) as MessageRow;
};

/** Rows newest first, from the highest id down to 1. */
const upTo = (newest: number, floor = 1) =>
  Array.from({ length: Math.max(0, newest - floor + 1) }, (_, i) => row(newest - i));

const input = (newest: number, overrides: Partial<TailInput> = {}): TailInput => ({
  rows: upTo(newest),
  total: newest,
  clearedBefore: 0,
  page: 1,
  ...overrides,
});

const ids = (rows: readonly MessageRow[]) => rows.map((r) => r.id);

describe('useMessageTail', () => {
  it('follows on page 1: new rows show at once', () => {
    const { result, rerender } = renderHook((props: TailInput) => useMessageTail(props), {
      initialProps: input(3),
    });
    expect(result.current.following).toBe(true);
    expect(ids(result.current.rows)).toEqual([3, 2, 1]);

    rerender(input(5));
    expect(ids(result.current.rows)).toEqual([5, 4, 3, 2, 1]);
    expect(result.current.following).toBe(true);
    expect(result.current.newSinceHeld).toBe(0);
  });

  it('holds the rows it had when the page leaves 1, and counts what arrives', () => {
    const { result, rerender } = renderHook((props: TailInput) => useMessageTail(props), {
      initialProps: input(4),
    });
    rerender(input(4, { page: 2 }));
    expect(result.current.following).toBe(false);
    expect(result.current.paused).toBe(false);
    expect(ids(result.current.rows)).toEqual([4, 3, 2, 1]);

    rerender(input(7, { page: 2 }));
    expect(ids(result.current.rows)).toEqual([4, 3, 2, 1]);
    expect(result.current.newSinceHeld).toBe(3);
  });

  it('follows again when the page comes back to 1', () => {
    const { result, rerender } = renderHook((props: TailInput) => useMessageTail(props), {
      initialProps: input(4),
    });
    rerender(input(4, { page: 3 }));
    rerender(input(9, { page: 3 }));
    rerender(input(9, { page: 1 }));
    expect(result.current.following).toBe(true);
    expect(ids(result.current.rows)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(result.current.newSinceHeld).toBe(0);
  });

  it('holds on page 1 when paused, and Resume follows again', () => {
    const { result, rerender } = renderHook((props: TailInput) => useMessageTail(props), {
      initialProps: input(3),
    });
    act(() => result.current.pause());
    expect(result.current.paused).toBe(true);
    expect(result.current.following).toBe(false);

    rerender(input(6));
    expect(ids(result.current.rows)).toEqual([3, 2, 1]);
    expect(result.current.newSinceHeld).toBe(3);

    act(() => result.current.resume());
    expect(result.current.paused).toBe(false);
    expect(result.current.following).toBe(true);
    expect(ids(result.current.rows)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('stays held on a page other than 1 after Resume, until the page goes back', () => {
    const { result, rerender } = renderHook((props: TailInput) => useMessageTail(props), {
      initialProps: input(3),
    });
    act(() => result.current.pause());
    rerender(input(3, { page: 2 }));
    act(() => result.current.resume());
    expect(result.current.following).toBe(false);
    rerender(input(4, { page: 1 }));
    expect(result.current.following).toBe(true);
  });

  it('counts by the total, not by the rows, when more arrive than the log holds', () => {
    const { result, rerender } = renderHook((props: TailInput) => useMessageTail(props), {
      initialProps: input(3),
    });
    act(() => result.current.pause());
    rerender({ rows: upTo(500, 301), total: 5000, clearedBefore: 0, page: 1 });
    expect(result.current.newSinceHeld).toBe(4997);
  });

  it('drops what Clear hid from a held copy, and shows nothing it did not hide', () => {
    const { result, rerender } = renderHook((props: TailInput) => useMessageTail(props), {
      initialProps: input(5),
    });
    act(() => result.current.pause());
    rerender(input(5, { rows: [], clearedBefore: 5 }));
    expect(ids(result.current.rows)).toEqual([]);

    rerender(input(7, { rows: upTo(7, 6), clearedBefore: 5 }));
    // Held: the copy is still the rows before the pause, all of them hidden; the two new ones are counted.
    expect(ids(result.current.rows)).toEqual([]);
    expect(result.current.newSinceHeld).toBe(2);
    act(() => result.current.resume());
    expect(ids(result.current.rows)).toEqual([7, 6]);
  });

  it('takes a new copy for each hold', () => {
    const { result, rerender } = renderHook((props: TailInput) => useMessageTail(props), {
      initialProps: input(2),
    });
    rerender(input(2, { page: 2 }));
    rerender(input(3, { page: 1 }));
    rerender(input(5, { page: 2 }));
    expect(ids(result.current.rows)).toEqual([5, 4, 3, 2, 1]);
  });
});

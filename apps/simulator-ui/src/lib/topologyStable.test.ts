import { describe, expect, it } from 'vitest';
import { sameValue, stabilize } from './topologyStable';

interface Item {
  id: string;
  data: { label: string; counts: number[]; nested?: { deep: boolean } };
}
const item = (id: string, label = id, counts: number[] = [1, 2]): Item => ({
  id,
  data: { label, counts, nested: { deep: true } },
});

describe('sameValue', () => {
  it('compares primitives, arrays and objects by content', () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue('a', 'b')).toBe(false);
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue([1, [2]], [1, [2]])).toBe(true);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue({ a: undefined }, { b: undefined })).toBe(false);
  });

  it('does not take an array for an object, or NaN for a different number', () => {
    expect(sameValue([], {})).toBe(false);
    expect(sameValue(NaN, NaN)).toBe(true);
    expect(sameValue(0, 1)).toBe(false);
  });
});

describe('stabilize', () => {
  it('keeps the previous object for every item whose content is equal', () => {
    const previous = [item('a'), item('b')];
    const next = [item('a'), item('b', 'changed')];
    const result = stabilize(previous, next);
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(next[1]);
    expect(result[1]).not.toBe(previous[1]);
  });

  it('returns the previous array itself when nothing changed, so the graph is not asked to look', () => {
    const previous = [item('a'), item('b')];
    expect(stabilize(previous, [item('a'), item('b')])).toBe(previous);
  });

  it('changes the array, but not the items, when the order changes', () => {
    const previous = [item('a'), item('b')];
    const result = stabilize(previous, [item('b'), item('a')]);
    expect(result).not.toBe(previous);
    expect(result[0]).toBe(previous[1]);
    expect(result[1]).toBe(previous[0]);
  });

  it('takes a new item as it is and drops one that left', () => {
    const previous = [item('a'), item('b')];
    const added = [item('a'), item('b'), item('c')];
    const grown = stabilize(previous, added);
    expect(grown).toHaveLength(3);
    expect(grown[0]).toBe(previous[0]);
    expect(grown[2]).toBe(added[2]);

    const shrunk = stabilize(previous, [item('b')]);
    expect(shrunk).toHaveLength(1);
    expect(shrunk[0]).toBe(previous[1]);
  });

  it('sees a change deep inside an item', () => {
    const previous = [item('a')];
    const next = [{ id: 'a', data: { label: 'a', counts: [1, 2], nested: { deep: false } } }];
    expect(stabilize(previous, next)[0]).toBe(next[0]);
  });

  it('matches by id, not by place', () => {
    const previous = [item('a'), item('b')];
    const result = stabilize(previous, [item('b'), item('a', 'changed')]);
    expect(result[0]).toBe(previous[1]);
    expect(result[1]).not.toBe(previous[0]);
  });

  it('starts from nothing', () => {
    const next = [item('a')];
    expect(stabilize([], next)).toEqual(next);
    expect(stabilize([], [])).toEqual([]);
  });

  it('does not change what it was given', () => {
    const previous = [item('a')];
    const next = [item('a', 'changed')];
    const frozen = structuredClone({ previous, next });
    stabilize(previous, next);
    expect({ previous, next }).toEqual(frozen);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { AnimationBudget, CAPS } from './animationBudget';

describe('AnimationBudget', () => {
  it('caps animated nodes at 12 and glowing lines at 24', () => {
    expect(CAPS).toEqual({ node: 12, line: 24 });
    const budget = new AnimationBudget();
    const nodes = Array.from({ length: 40 }, () => budget.acquire('node'));
    const lines = Array.from({ length: 60 }, () => budget.acquire('line'));

    expect(nodes.filter((s) => s.isGranted())).toHaveLength(12);
    expect(lines.filter((s) => s.isGranted())).toHaveLength(24);
    expect(budget.counts('node')).toEqual({ held: 40, granted: 12 });
    expect(budget.counts('line')).toEqual({ held: 60, granted: 24 });
  });

  it('grants in the order slots were asked for', () => {
    const budget = new AnimationBudget({ node: 2, line: 1 });
    const [a, b, c] = [budget.acquire('node'), budget.acquire('node'), budget.acquire('node')];
    expect([a, b, c].map((s) => s.isGranted())).toEqual([true, true, false]);
  });

  it('hands a released slot to the first one waiting, and tells it', () => {
    const budget = new AnimationBudget({ node: 1, line: 1 });
    const first = budget.acquire('node');
    const onChange = vi.fn();
    const second = budget.acquire('node', onChange);
    const third = budget.acquire('node');
    expect(second.isGranted()).toBe(false);

    first.release();

    expect(second.isGranted()).toBe(true);
    expect(third.isGranted()).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(budget.counts('node')).toEqual({ held: 2, granted: 1 });
  });

  it('does not tell a slot that nothing changed for', () => {
    const budget = new AnimationBudget({ node: 1, line: 1 });
    const onChange = vi.fn();
    budget.acquire('node');
    const waiting = budget.acquire('node', onChange);
    budget.acquire('node');
    expect(waiting.isGranted()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('counts the two kinds apart', () => {
    const budget = new AnimationBudget({ node: 1, line: 1 });
    expect(budget.acquire('node').isGranted()).toBe(true);
    expect(budget.acquire('line').isGranted()).toBe(true);
    expect(budget.acquire('node').isGranted()).toBe(false);
  });

  it('can release twice, and a released slot is no longer granted', () => {
    const budget = new AnimationBudget({ node: 1, line: 1 });
    const slot = budget.acquire('node');
    slot.release();
    slot.release();
    expect(slot.isGranted()).toBe(false);
    expect(budget.counts('node')).toEqual({ held: 0, granted: 0 });
    expect(budget.acquire('node').isGranted()).toBe(true);
  });
});

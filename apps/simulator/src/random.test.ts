import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { seededRandom } from './random.ts';

const take = (random: () => number, count: number) => Array.from({ length: count }, random);

describe('seededRandom', () => {
  it('gives the same sequence for the same seed', () => {
    assert.deepEqual(take(seededRandom(42), 20), take(seededRandom(42), 20));
  });

  it('gives a different sequence for a different seed', () => {
    assert.notDeepEqual(take(seededRandom(1), 20), take(seededRandom(2), 20));
  });

  it('stays in [0, 1) and does not repeat one value', () => {
    const values = take(seededRandom(7), 1000);
    assert.ok(values.every((v) => v >= 0 && v < 1));
    assert.ok(new Set(values).size > 990);
  });

  it('keeps two generators with the same seed independent of each other', () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    a();
    a();
    assert.deepEqual(take(b, 5), take(seededRandom(5), 5));
  });
});

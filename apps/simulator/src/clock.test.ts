import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ManualClock, systemClock } from './clock.ts';

describe('ManualClock', () => {
  it('stands still until it is advanced', () => {
    const clock = new ManualClock(1_000);
    assert.equal(clock.now(), 1_000);
  });

  it('fires the timers inside the window in time order, with now() at each due time', async () => {
    const clock = new ManualClock(0);
    const seen: string[] = [];
    clock.setTimer(300, () => void seen.push(`c@${clock.now()}`));
    clock.setTimer(100, () => void seen.push(`a@${clock.now()}`));
    clock.setTimer(100, () => void seen.push(`b@${clock.now()}`));
    clock.setTimer(900, () => void seen.push('late'));

    await clock.advance(500);

    assert.deepEqual(seen, ['a@100', 'b@100', 'c@300']);
    assert.equal(clock.now(), 500);
  });

  it('waits for an async callback before it starts the next timer', async () => {
    const clock = new ManualClock(0);
    const seen: string[] = [];
    clock.setTimer(10, async () => {
      seen.push('first starts');
      await new Promise((resolve) => setImmediate(resolve));
      seen.push('first ends');
    });
    clock.setTimer(20, () => void seen.push('second'));

    await clock.advance(30);

    assert.deepEqual(seen, ['first starts', 'first ends', 'second']);
  });

  it('fires a timer that a callback sets inside the same window, and keeps one beyond it', async () => {
    const clock = new ManualClock(0);
    const seen: number[] = [];
    const every100 = () => {
      seen.push(clock.now());
      clock.setTimer(100, every100);
    };
    clock.setTimer(100, every100);

    await clock.advance(350);
    assert.deepEqual(seen, [100, 200, 300]);

    await clock.advance(100); // 350 to 450: the timer due at 400 fires
    assert.deepEqual(seen, [100, 200, 300, 400]);
  });

  it('fires a timer with no delay on the next advance, even by zero', async () => {
    const clock = new ManualClock(50);
    let fired = false;
    clock.setTimer(0, () => {
      fired = true;
    });
    assert.equal(fired, false);

    await clock.advance(0);

    assert.equal(fired, true);
    assert.equal(clock.now(), 50);
  });

  it('does not fire a timer that was cancelled', async () => {
    const clock = new ManualClock(0);
    let fired = false;
    const cancel = clock.setTimer(10, () => {
      fired = true;
    });
    cancel();

    await clock.advance(100);

    assert.equal(fired, false);
  });

  it('rejects a negative or non-finite step', async () => {
    const clock = new ManualClock(0);
    await assert.rejects(clock.advance(-1), RangeError);
    await assert.rejects(clock.advance(Number.NaN), RangeError);
  });
});

describe('systemClock', () => {
  it('reports the wall clock', () => {
    const before = Date.now();
    const now = systemClock.now();
    assert.ok(now >= before && now <= Date.now());
  });

  it('fires a timer once, and not after it was cancelled', async () => {
    await new Promise<void>((resolve) => systemClock.setTimer(1, resolve));

    let fired = false;
    const cancel = systemClock.setTimer(20, () => {
      fired = true;
    });
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(fired, false);
  });
});

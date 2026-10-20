import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OBSERVATION_CAPACITY,
  ObservationStore,
  PAGE_MAX,
  RingBuffer,
} from './observation-store.ts';

const AT = '2026-10-20T08:00:00.000Z';
const draft = (n: number) => ({ kind: 'engine-state' as const, data: { n } });

function filled(count: number, capacity?: number): ObservationStore {
  const store = new ObservationStore(capacity);
  for (let i = 1; i <= count; i++) store.append(draft(i), AT);
  return store;
}

describe('RingBuffer', () => {
  it('keeps items oldest first until it is full', () => {
    const ring = new RingBuffer<number>(3);
    ring.push(1);
    ring.push(2);
    assert.deepEqual(ring.toArray(), [1, 2]);
    assert.equal(ring.size, 2);
    assert.equal(ring.capacity, 3);
  });

  it('forgets the oldest item when it is full, and keeps the order across the wrap', () => {
    const ring = new RingBuffer<number>(3);
    for (let i = 1; i <= 8; i++) ring.push(i);
    assert.deepEqual(ring.toArray(), [6, 7, 8]);
    assert.equal(ring.size, 3);
  });

  it('is empty at first, and rejects a capacity below 1', () => {
    assert.deepEqual(new RingBuffer<number>(2).toArray(), []);
    assert.throws(() => new RingBuffer<number>(0), RangeError);
    assert.throws(() => new RingBuffer<number>(1.5), RangeError);
  });
});

describe('ObservationStore ids and bound', () => {
  it('gives ids that rise from 1, with the time it was given', () => {
    const store = new ObservationStore();
    assert.equal(store.latestId(), 0);
    const first = store.append(draft(1), AT);
    const second = store.append(
      { kind: 'delivery', data: { status: 'delivered' } },
      '2026-10-20T08:00:01.000Z',
    );
    assert.deepEqual([first.id, second.id], [1, 2]);
    assert.equal(second.at, '2026-10-20T08:00:01.000Z');
    assert.equal(second.kind, 'delivery');
    assert.equal(store.latestId(), 2);
  });

  it('keeps the last 5,000 events: the 5,001st evicts the first and ids keep rising', () => {
    assert.equal(OBSERVATION_CAPACITY, 5000);
    const store = filled(5001);
    const everything = store.page({ limit: PAGE_MAX });
    assert.equal(everything.events[0]?.id, 5001);

    // Walk back through all pages: 5,000 events, ids 5001 down to 2.
    const ids: number[] = [];
    let before: number | undefined;
    do {
      const page = store.page({ before, limit: PAGE_MAX });
      ids.push(...page.events.map((e) => e.id));
      before = page.next;
    } while (before !== undefined);

    assert.equal(ids.length, 5000);
    assert.equal(ids[0], 5001);
    assert.equal(ids.at(-1), 2);
    assert.equal(store.latestId(), 5001);
  });
});

describe('ObservationStore.page', () => {
  it('returns the newest events first', () => {
    const page = filled(5).page();
    assert.deepEqual(
      page.events.map((e) => e.id),
      [5, 4, 3, 2, 1],
    );
    assert.equal(page.next, undefined);
  });

  it('pages with limit and before, and gives a cursor only while older events remain', () => {
    const store = filled(7);
    const first = store.page({ limit: 3 });
    assert.deepEqual(
      first.events.map((e) => e.id),
      [7, 6, 5],
    );
    assert.equal(first.next, 5);

    const second = store.page({ before: first.next, limit: 3 });
    assert.deepEqual(
      second.events.map((e) => e.id),
      [4, 3, 2],
    );
    assert.equal(second.next, 2);

    const third = store.page({ before: second.next, limit: 3 });
    assert.deepEqual(
      third.events.map((e) => e.id),
      [1],
    );
    assert.equal(third.next, undefined);
  });

  it('gives no cursor when the last page is exactly full', () => {
    const page = filled(3).page({ limit: 3 });
    assert.equal(page.events.length, 3);
    assert.equal(page.next, undefined);
  });

  it('clamps the limit to 1 to 500 and defaults it to 100', () => {
    const store = filled(700);
    assert.equal(store.page().events.length, 100);
    assert.equal(store.page({ limit: 0 }).events.length, 1);
    assert.equal(store.page({ limit: -5 }).events.length, 1);
    assert.equal(store.page({ limit: 10_000 }).events.length, 500);
    assert.equal(store.page({ limit: Number.NaN }).events.length, 100);
  });

  it('is empty for an empty store and for a before older than everything kept', () => {
    assert.deepEqual(new ObservationStore().page(), { events: [], next: undefined });
    assert.deepEqual(filled(3).page({ before: 1 }), { events: [], next: undefined });
  });

  it('treats the evicted ids as gone, with no cursor into them', () => {
    const store = filled(10, 4); // keeps 7 to 10
    const page = store.page({ limit: 2 });
    assert.deepEqual(
      page.events.map((e) => e.id),
      [10, 9],
    );
    assert.equal(page.next, 9);
    const last = store.page({ before: 9, limit: 5 });
    assert.deepEqual(
      last.events.map((e) => e.id),
      [8, 7],
    );
    assert.equal(last.next, undefined);
  });
});

describe('ObservationStore.byKind', () => {
  it('returns the events of one kind, oldest first, and none of the others', () => {
    const store = new ObservationStore();
    store.append({ kind: 'engine-state', data: { n: 1 } }, AT);
    store.append({ kind: 'scenario-run', data: { name: 'a' } }, AT);
    store.append({ kind: 'alert-opened', data: {} }, AT);
    store.append({ kind: 'scenario-run', data: { name: 'b' } }, AT);

    assert.deepEqual(
      store.byKind('scenario-run').map((e) => [e.id, e.data.name]),
      [
        [2, 'a'],
        [4, 'b'],
      ],
    );
    assert.deepEqual(store.byKind('incident'), []);
  });

  it('forgets an event with the ring, like page() does', () => {
    const store = new ObservationStore(2);
    store.append({ kind: 'scenario-run', data: { name: 'old' } }, AT);
    store.append({ kind: 'engine-state', data: {} }, AT);
    store.append({ kind: 'engine-state', data: {} }, AT);
    assert.deepEqual(store.byKind('scenario-run'), []);
  });
});

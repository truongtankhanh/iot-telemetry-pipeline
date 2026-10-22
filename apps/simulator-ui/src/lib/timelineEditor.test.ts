import { describe, expect, it } from 'vitest';
import type { Anomaly } from '../api/types';
import {
  addEntry,
  addEntryDisabledReason,
  anomaliesOf,
  copyName,
  copyOf,
  editEntry,
  EMPTY_DOC,
  fromAnomalies,
  fromScenario,
  isDirty,
  lengthOf,
  MAX_EDITOR_ANOMALIES,
  moveEntry,
  removeEntry,
  resizeEntry,
  roomOf,
  setDescription,
  setName,
  snapTo,
  toDocument,
} from './timelineEditor';

const anomaly = (
  deviceId: string,
  metric: Anomaly['metric'],
  value: number,
  startAt: number,
  duration: number,
  shape?: Anomaly['shape'],
): Anomaly => ({
  deviceId,
  metric,
  value,
  startAt,
  duration,
  ...(shape === undefined ? {} : { shape }),
});

const A = anomaly('dc-env-01', 'temperature_c', 29.2, 10, 20); //  10 to 30
const B = anomaly('dc-env-01', 'temperature_c', 31, 50, 20); //    50 to 70
const C = anomaly('lib-air-01', 'co2_ppm', 1450, 0, 100); //        another signal

/** A and B on one signal, C on another: ids a1, a2, a3. */
const doc = () => fromAnomalies([A, B, C]);

describe('building a copy', () => {
  it('opens a scenario with ids a1…, a copy of its anomalies, and the next id after them', () => {
    const source = { name: 'hot', description: 'Row A.', anomalies: [A, B] };
    const opened = fromScenario(source);
    expect(opened.entries.map((e) => e.id)).toEqual(['a1', 'a2']);
    expect(opened.nextId).toBe(3);
    expect(opened.name).toBe('hot');
    opened.entries[0]!.anomaly.value = 1;
    expect(source.anomalies[0]?.value).toBe(29.2);
  });

  it('opens a copy under a new name and a handed-over list with no name', () => {
    const source = { name: 'hot', description: 'Row A.', anomalies: [A] };
    expect(copyOf(source).name).toBe('hot-copy');
    expect(copyOf(source).description).toBe('Row A.');
    expect(fromAnomalies([A])).toMatchObject({ name: '', description: '', nextId: 2 });
  });

  it('cuts the name of a copy so that it still fits the 64 characters of the format', () => {
    const long = 'a'.repeat(64);
    expect(copyName(long)).toHaveLength(64);
    expect(copyName(long).endsWith('-copy')).toBe(true);
    expect(copyName('x')).toBe('x-copy');
  });

  it('has an empty document to start from', () => {
    expect(EMPTY_DOC).toEqual({ name: '', description: '', entries: [], nextId: 1 });
    expect(lengthOf(EMPTY_DOC)).toBe(0);
  });
});

describe('the document', () => {
  it('writes the fields in the order of the file and a shape only when there is one', () => {
    const written = toDocument(
      fromScenario({
        name: 'x',
        description: '',
        anomalies: [
          {
            shape: 'ramp',
            duration: 5,
            startAt: 1,
            value: 30,
            metric: 'temperature_c',
            deviceId: 'a',
          },
          { duration: 5, startAt: 1, value: 40, metric: 'humidity_pct', deviceId: 'b' },
        ],
      }),
    );
    expect(Object.keys(written)).toEqual(['name', 'description', 'anomalies']);
    expect(Object.keys(written.anomalies[0]!)).toEqual([
      'deviceId',
      'metric',
      'value',
      'startAt',
      'duration',
      'shape',
    ]);
    expect(Object.keys(written.anomalies[1]!)).toEqual([
      'deviceId',
      'metric',
      'value',
      'startAt',
      'duration',
    ]);
  });

  it('reads back the text the simulator writes, byte for byte', () => {
    const text = `${JSON.stringify(
      {
        name: 'bad-afternoon',
        description: 'A hot afternoon.',
        anomalies: [
          {
            deviceId: 'dc-env-01',
            metric: 'temperature_c',
            value: 29.2,
            startAt: 45,
            duration: 60,
            shape: 'ramp',
          },
        ],
      },
      null,
      2,
    )}\n`;
    const parsed = JSON.parse(text) as Parameters<typeof fromScenario>[0];
    expect(`${JSON.stringify(toDocument(fromScenario(parsed)), null, 2)}\n`).toBe(text);
  });

  it('measures the scenario to the end of its last anomaly, not of the last one listed', () => {
    expect(lengthOf(fromAnomalies([B, A]))).toBe(70);
    expect(anomaliesOf(doc())).toEqual([A, B, C]);
  });
});

describe('isDirty', () => {
  const saved = { name: 'hot', description: '', anomalies: [A] };

  it('is false for a copy that equals what is saved, whatever its ids', () => {
    expect(isDirty(fromScenario(saved), saved)).toBe(false);
  });

  it('is true for any change to the name, the description or an anomaly', () => {
    const opened = fromScenario(saved);
    expect(isDirty(setDescription(opened, 'x'), saved)).toBe(true);
    expect(isDirty(setName(opened, 'cold'), saved)).toBe(true);
    const edited = editEntry(opened, 'a1', { value: 30 });
    expect(edited.ok && isDirty(edited.doc, saved)).toBe(true);
    expect(isDirty(removeEntry(opened, 'a1'), saved)).toBe(true);
  });

  it('counts a copy that is saved nowhere as changed as soon as it holds anything', () => {
    expect(isDirty(EMPTY_DOC, null)).toBe(false);
    expect(isDirty(setName(EMPTY_DOC, 'x'), null)).toBe(true);
    expect(isDirty(setDescription(EMPTY_DOC, 'x'), null)).toBe(true);
    expect(isDirty(fromAnomalies([A]), null)).toBe(true);
  });
});

describe('snap', () => {
  it('rounds to the grid and to a tenth', () => {
    expect(snapTo(12.4, 5)).toBe(10);
    expect(snapTo(12.6, 5)).toBe(15);
    expect(snapTo(12.34, 1)).toBe(12);
    expect(snapTo(7.26, 0.1)).toBe(7.3);
  });
});

describe('room', () => {
  it('is bounded by the neighbours on the same device and metric only', () => {
    expect(roomOf(doc(), 'a1')).toEqual({ left: 0, right: 50 });
    expect(roomOf(doc(), 'a2')).toEqual({ left: 30, right: Infinity });
    expect(roomOf(doc(), 'a3')).toEqual({ left: 0, right: Infinity });
    expect(roomOf(doc(), 'nope')).toBeNull();
  });
});

describe('moveEntry', () => {
  it('moves to the snapped start and keeps the length', () => {
    const { doc: moved, notice } = moveEntry(doc(), 'a1', 22, 5);
    expect(moved.entries[0]?.anomaly).toMatchObject({ startAt: 20, duration: 20 });
    expect(notice).toBeNull();
  });

  it('snaps to a second when the snap is off', () => {
    expect(moveEntry(doc(), 'a1', 22.4, 1).doc.entries[0]?.anomaly.startAt).toBe(22);
  });

  it('stops at the edge of the next block and says so', () => {
    const { doc: moved, notice } = moveEntry(doc(), 'a1', 40, 5);
    expect(moved.entries[0]?.anomaly.startAt).toBe(30); // 30 + 20 = 50, B's start
    expect(notice).toBe('Stopped at the edge of the next block on dc-env-01 temperature_c');
  });

  it('stops at the end of the block before it', () => {
    const { doc: moved, notice } = moveEntry(doc(), 'a2', 0, 5);
    expect(moved.entries[1]?.anomaly.startAt).toBe(30);
    expect(notice).toBe('Stopped at the edge of the next block on dc-env-01 temperature_c');
  });

  it('stops at 0 without a sentence: the left edge of the picture is not a neighbour', () => {
    const { doc: moved, notice } = moveEntry(doc(), 'a1', -10, 5);
    expect(moved.entries[0]?.anomaly.startAt).toBe(0);
    expect(notice).toBeNull();
  });

  it('is not held back by a block on another signal', () => {
    const { doc: moved, notice } = moveEntry(doc(), 'a3', 500, 5);
    expect(moved.entries[2]?.anomaly.startAt).toBe(500);
    expect(notice).toBeNull();
  });

  it('leaves the copy it was given as it was, and an unknown id alone', () => {
    const before = doc();
    moveEntry(before, 'a1', 40, 5);
    expect(before.entries[0]?.anomaly.startAt).toBe(10);
    expect(moveEntry(before, 'nope', 5, 5)).toEqual({ doc: before, notice: null });
  });
});

describe('resizeEntry', () => {
  it('moves the end edge: the start stays, the duration follows', () => {
    const { doc: resized, notice } = resizeEntry(doc(), 'a1', 'end', 38, 5);
    expect(resized.entries[0]?.anomaly).toMatchObject({ startAt: 10, duration: 30 });
    expect(notice).toBeNull();
  });

  it('stops the end edge at the next block and says so', () => {
    const { doc: resized, notice } = resizeEntry(doc(), 'a1', 'end', 80, 5);
    expect(resized.entries[0]?.anomaly).toMatchObject({ startAt: 10, duration: 40 });
    expect(notice).toBe('Stopped at the edge of the next block on dc-env-01 temperature_c');
  });

  it('keeps at least one second', () => {
    expect(resizeEntry(doc(), 'a1', 'end', 5, 5).doc.entries[0]?.anomaly.duration).toBe(1);
    expect(resizeEntry(doc(), 'a1', 'start', 100, 5).doc.entries[0]?.anomaly).toMatchObject({
      startAt: 29,
      duration: 1,
    });
  });

  it('keeps at most 3,600 s without a sentence', () => {
    const { doc: resized, notice } = resizeEntry(doc(), 'a3', 'end', 9999, 5);
    expect(resized.entries[2]?.anomaly.duration).toBe(3600);
    expect(notice).toBeNull();
  });

  it('moves the start edge: the end stays, the start and the duration change', () => {
    const { doc: resized, notice } = resizeEntry(doc(), 'a1', 'start', 4, 5);
    expect(resized.entries[0]?.anomaly).toMatchObject({ startAt: 5, duration: 25 });
    expect(notice).toBeNull();
  });

  it('stops the start edge at the block before and says so', () => {
    const { doc: resized, notice } = resizeEntry(doc(), 'a2', 'start', 0, 5);
    expect(resized.entries[1]?.anomaly).toMatchObject({ startAt: 30, duration: 40 });
    expect(notice).toBe('Stopped at the edge of the next block on dc-env-01 temperature_c');
  });

  it('leaves an unknown id alone', () => {
    const before = doc();
    expect(resizeEntry(before, 'nope', 'end', 5, 5)).toEqual({ doc: before, notice: null });
  });
});

describe('addEntry', () => {
  it('adds with the next id and counts on', () => {
    const added = addEntry(doc(), anomaly('lib-air-01', 'temperature_c', 30, 5, 10));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.id).toBe('a4');
    expect(added.doc.nextId).toBe(5);
    expect(added.doc.entries).toHaveLength(4);
  });

  it('refuses an anomaly that plays at once with another on its device and metric, with the reason', () => {
    const clash = addEntry(doc(), anomaly('dc-env-01', 'temperature_c', 30, 25, 10));
    expect(clash).toEqual({
      ok: false,
      reason: 'dc-env-01 already has a fault on temperature_c in the scenario from 10 s to 30 s',
    });
  });

  it('accepts windows that only touch, and the same window on another metric or device', () => {
    expect(addEntry(doc(), anomaly('dc-env-01', 'temperature_c', 30, 30, 20)).ok).toBe(true);
    expect(addEntry(doc(), anomaly('dc-env-01', 'humidity_pct', 60, 10, 20)).ok).toBe(true);
    expect(addEntry(doc(), anomaly('dc-env-02', 'temperature_c', 30, 10, 20)).ok).toBe(true);
  });

  it('refuses the 51st anomaly', () => {
    let full = EMPTY_DOC;
    for (let i = 0; i < MAX_EDITOR_ANOMALIES; i++) {
      const added = addEntry(full, anomaly('dc-env-01', 'temperature_c', 30, i * 10, 5));
      expect(added.ok).toBe(true);
      if (added.ok) full = added.doc;
    }
    expect(addEntry(full, anomaly('dc-env-02', 'temperature_c', 30, 0, 5))).toEqual({
      ok: false,
      reason: 'A scenario holds at most 50 anomalies',
    });
    expect(addEntryDisabledReason(full)).toBe('A scenario holds at most 50 anomalies');
    expect(addEntryDisabledReason(doc())).toBeNull();
  });
});

describe('editEntry', () => {
  it('changes the fields it is given and nothing else', () => {
    const edited = editEntry(doc(), 'a1', { value: 31.5, duration: 25 });
    expect(edited.ok && edited.doc.entries[0]?.anomaly).toEqual({
      ...A,
      value: 31.5,
      duration: 25,
    });
  });

  it('sets a shape, and takes it away for a step', () => {
    const ramp = editEntry(doc(), 'a1', { shape: 'ramp' });
    expect(ramp.ok && ramp.doc.entries[0]?.anomaly.shape).toBe('ramp');
    if (!ramp.ok) return;
    const step = editEntry(ramp.doc, 'a1', { shape: 'step' });
    expect(step.ok && 'shape' in step.doc.entries[0]!.anomaly).toBe(false);
    const none = editEntry(ramp.doc, 'a1', { shape: undefined });
    expect(none.ok && 'shape' in none.doc.entries[0]!.anomaly).toBe(false);
  });

  it('refuses a change that would play at once with another, and leaves the copy as it was', () => {
    const before = doc();
    const longer = editEntry(before, 'a1', { duration: 45 }); // 10 to 55 meets B at 50
    expect(longer.ok).toBe(false);
    expect(!longer.ok && longer.reason).toBe(
      'dc-env-01 already has a fault on temperature_c in the scenario from 50 s to 70 s',
    );
    expect(before.entries[0]?.anomaly.duration).toBe(20);
  });

  it('allows moving to a device or metric where there is room', () => {
    const moved = editEntry(doc(), 'a1', { deviceId: 'dc-env-02' });
    expect(moved.ok && moved.doc.entries[0]?.anomaly.deviceId).toBe('dc-env-02');
  });

  it('keeps a value that is out of range (the validation says so) and refuses what is not a number', () => {
    const wild = editEntry(doc(), 'a1', { value: 900 });
    expect(wild.ok && wild.doc.entries[0]?.anomaly.value).toBe(900);
    expect(editEntry(doc(), 'a1', { value: Number.NaN })).toEqual({
      ok: false,
      reason: 'Enter a number',
    });
    expect(editEntry(doc(), 'a1', { startAt: Infinity }).ok).toBe(false);
  });

  it('says so for an id that is gone', () => {
    expect(editEntry(doc(), 'nope', { value: 1 })).toEqual({
      ok: false,
      reason: 'That anomaly is gone',
    });
  });
});

describe('removing and naming', () => {
  it('removes an entry and leaves the ids of the others', () => {
    const left = removeEntry(doc(), 'a2');
    expect(left.entries.map((e) => e.id)).toEqual(['a1', 'a3']);
    expect(left.nextId).toBe(4);
  });

  it('sets the name and the description', () => {
    expect(setName(EMPTY_DOC, 'x').name).toBe('x');
    expect(setDescription(EMPTY_DOC, 'y').description).toBe('y');
  });
});

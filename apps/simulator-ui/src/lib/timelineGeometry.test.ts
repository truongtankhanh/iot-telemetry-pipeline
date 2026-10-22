import { describe, expect, it } from 'vitest';
import {
  deltaS,
  effectiveWindow,
  groupedAbove,
  keyEdit,
  moveTarget,
  secondsPerPx,
  timeAt,
  toggleZone,
  windowFor,
  windowOptions,
} from './timelineGeometry';

const axis = { left: 100, right: 700, maxS: 120 }; // 5 px a second

describe('windowFor', () => {
  it('is the smallest of 120, 180 and 300 s that holds the scenario', () => {
    expect(windowFor(0)).toBe(120);
    expect(windowFor(120)).toBe(120);
    expect(windowFor(120.1)).toBe(180);
    expect(windowFor(180)).toBe(180);
    expect(windowFor(300)).toBe(300);
  });

  it('is what the axis can number for a longer scenario', () => {
    expect(windowFor(301)).toBe(360);
    expect(windowFor(420)).toBe(480);
    expect(windowFor(900)).toBe(900);
  });
});

describe('windowOptions', () => {
  it('disables the windows that are too short', () => {
    expect(windowOptions(150)).toEqual([
      { value: 120, label: '120 s', disabled: true },
      { value: 180, label: '180 s', disabled: false },
      { value: 300, label: '300 s', disabled: false },
    ]);
  });

  it('offers the scenario’s own window when it needs more than 300 s', () => {
    const options = windowOptions(420);
    expect(options.map((o) => [o.value, o.disabled])).toEqual([
      [120, true],
      [180, true],
      [300, true],
      [480, false],
    ]);
    expect(options[3]?.label).toBe('480 s');
  });

  it('enables every window for an empty scenario', () => {
    expect(windowOptions(0).every((o) => !o.disabled)).toBe(true);
  });
});

describe('effectiveWindow', () => {
  it('keeps the window that was chosen while it holds the scenario', () => {
    expect(effectiveWindow(300, 50)).toBe(300);
    expect(effectiveWindow(180, 150)).toBe(180);
  });

  it('widens to the smallest window that holds the scenario', () => {
    expect(effectiveWindow(120, 150)).toBe(180);
    expect(effectiveWindow(null, 50)).toBe(120);
    expect(effectiveWindow(null, 400)).toBe(480);
  });

  it('forgets a window that is not offered any more', () => {
    expect(effectiveWindow(480, 100)).toBe(120);
  });
});

describe('pixels and seconds', () => {
  it('knows what a pixel is worth', () => {
    expect(secondsPerPx(axis)).toBe(0.2);
    expect(deltaS(axis, 50)).toBe(10);
    expect(deltaS(axis, -25)).toBe(-5);
  });

  it('turns an x into a time inside the window', () => {
    expect(timeAt(axis, 400)).toBe(60);
    expect(timeAt(axis, 50)).toBe(0);
    expect(timeAt(axis, 900)).toBe(120);
  });

  it('keeps a dragged block inside the window', () => {
    expect(moveTarget(axis, 10, 100, 20)).toBe(30);
    expect(moveTarget(axis, 10, 10000, 20)).toBe(100); // 120 − 20
    expect(moveTarget(axis, 10, -10000, 20)).toBe(0);
    expect(moveTarget(axis, 0, 10, 500)).toBe(0); // longer than the window: starts at 0
  });
});

describe('keyEdit', () => {
  const none = { shift: false, alt: false };
  it('moves by the step, left or right', () => {
    expect(keyEdit('ArrowRight', none, 5)).toEqual({ action: 'move', delta: 5 });
    expect(keyEdit('ArrowLeft', none, 5)).toEqual({ action: 'move', delta: -5 });
  });

  it('resizes the end with Shift and the start with Shift and Alt', () => {
    expect(keyEdit('ArrowRight', { shift: true, alt: false }, 1)).toEqual({
      action: 'resize-end',
      delta: 1,
    });
    expect(keyEdit('ArrowLeft', { shift: true, alt: true }, 1)).toEqual({
      action: 'resize-start',
      delta: -1,
    });
  });

  it('has nothing to say about other keys', () => {
    expect(keyEdit('ArrowUp', none, 5)).toBeNull();
    expect(keyEdit('a', none, 5)).toBeNull();
  });
});

describe('groups', () => {
  it('groups above 12 anomalies', () => {
    expect(groupedAbove(12)).toBe(false);
    expect(groupedAbove(13)).toBe(true);
  });

  it('opens and closes a zone without changing the set it was given', () => {
    const none: ReadonlySet<string> = new Set();
    const opened = toggleZone(none, 'BLD-DC');
    expect([...opened]).toEqual(['BLD-DC']);
    expect([...none]).toEqual([]);
    expect([...toggleZone(opened, 'BLD-DC')]).toEqual([]);
  });
});

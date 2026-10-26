import { describe, expect, it } from 'vitest';
import { LABEL_SEPARATION_PX, placeLabel, projectToScreen, visibleLabels } from './twinProject';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A matrix whose `w` is minus `z`: what a perspective projection does, so a point is in front when its `z` is negative. */
const LOOKING_DOWN_Z = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0];

describe('projectToScreen', () => {
  it('puts the centre of the view in the middle of the canvas, y growing downwards', () => {
    expect(projectToScreen(IDENTITY, [0, 0, 0], 800, 600)).toEqual({
      x: 400,
      y: 300,
      visible: true,
    });
    const upperRight = projectToScreen(IDENTITY, [0.5, 0.5, 0], 800, 600);
    expect(upperRight.x).toBe(600);
    expect(upperRight.y).toBe(150);
  });

  it('is not visible outside the view', () => {
    expect(projectToScreen(IDENTITY, [2, 0, 0], 800, 600).visible).toBe(false);
    expect(projectToScreen(IDENTITY, [0, -1.5, 0], 800, 600).visible).toBe(false);
  });

  it('is not visible behind the camera, where `w` is not positive', () => {
    expect(projectToScreen(LOOKING_DOWN_Z, [0, 0, -2], 800, 600).visible).toBe(true);
    expect(projectToScreen(LOOKING_DOWN_Z, [0, 0, 2], 800, 600).visible).toBe(false);
    expect(projectToScreen(LOOKING_DOWN_Z, [0, 0, 0], 800, 600).visible).toBe(false);
  });
});

describe('placeLabel', () => {
  const size = { width: 60, height: 20 };
  const canvas = { width: 400, height: 300 };

  it('centres the label above the pin, a gap over it', () => {
    expect(placeLabel({ x: 100, y: 100 }, size, canvas)).toEqual({
      left: 70,
      top: 70,
      below: false,
    });
  });

  it('puts it under the pin when the top of the canvas is too close', () => {
    expect(placeLabel({ x: 100, y: 10 }, size, canvas)).toEqual({ left: 70, top: 20, below: true });
  });

  it('keeps it inside the canvas on the left and on the right', () => {
    expect(placeLabel({ x: 5, y: 100 }, size, canvas).left).toBe(4);
    expect(placeLabel({ x: 399, y: 100 }, size, canvas).left).toBe(400 - 60 - 4);
  });
});

describe('visibleLabels', () => {
  const box = (left: number, top: number) => ({ left, top, width: 100, height: 40 });

  it('keeps every label when none covers another', () => {
    const shown = visibleLabels([
      { id: 'a', box: box(0, 0) },
      { id: 'b', box: box(200, 0) },
      { id: 'c', box: box(0, 100) },
    ]);
    expect([...shown]).toEqual(['a', 'b', 'c']);
  });

  it('keeps the one that comes first and drops the later one that covers it', () => {
    const shown = visibleLabels([
      { id: 'selected', box: box(0, 0) },
      { id: 'other', box: box(50, 10) },
    ]);
    expect([...shown]).toEqual(['selected']);
  });

  it('asks for a gap: labels that nearly touch are separate, labels closer than the gap are not', () => {
    const far = visibleLabels([
      { id: 'a', box: box(0, 0) },
      { id: 'b', box: box(100 + LABEL_SEPARATION_PX + 1, 0) },
    ]);
    expect(far.has('b')).toBe(true);
    const near = visibleLabels([
      { id: 'a', box: box(0, 0) },
      { id: 'b', box: box(100 + LABEL_SEPARATION_PX - 1, 0) },
    ]);
    expect(near.has('b')).toBe(false);
  });

  it('compares a label only with the ones that were kept, not with the ones that were dropped', () => {
    // a covers b, b covers c, a does not reach c: b is dropped, so c stays.
    const shown = visibleLabels([
      { id: 'a', box: box(0, 0) },
      { id: 'b', box: box(90, 0) },
      { id: 'c', box: box(180, 0) },
    ]);
    expect([...shown]).toEqual(['a', 'c']);
  });

  it('is empty for no labels', () => {
    expect(visibleLabels([]).size).toBe(0);
  });
});

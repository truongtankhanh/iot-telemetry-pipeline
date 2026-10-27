import { describe, expect, it } from 'vitest';
import { twinLayoutFixture } from '../api/fixtures/twinLayout';
import type { TwinLayout } from '../api/types';
import { cameraMove } from './twinDemoCamera';
import { buildingBounds } from './twinGeometry';

const layout = twinLayoutFixture.layout as TwinLayout;

describe('cameraMove', () => {
  it('flies to the campus and clears the selection, so the level goes back up with the camera', () => {
    expect(cameraMove('campus', layout)).toEqual({
      move: { fly: 'campus', select: null },
      problem: null,
    });
  });

  it('flies overhead and leaves the selection as the viewer had it', () => {
    const { move, problem } = cameraMove('top', layout);
    expect(problem).toBeNull();
    expect(move?.fly).toBe('top');
    // `undefined`, not `null`: null would clear the selection.
    expect(move !== null && 'select' in move).toBe(true);
    expect(move?.select).toBeUndefined();
  });

  it('flies to a building and selects it, because the focus is derived from the selection', () => {
    const { move, problem } = cameraMove({ building: 'BLD-DC' }, layout);
    expect(problem).toBeNull();
    expect(move?.select).toEqual({ type: 'zone', id: 'BLD-DC' });
    expect(move?.fly).toEqual({ building: buildingBounds(layout, 'BLD-DC') });
  });

  it('flies to each building at its own bounds', () => {
    const dc = cameraMove({ building: 'BLD-DC' }, layout).move?.fly;
    const lib = cameraMove({ building: 'BLD-LIB' }, layout).move?.fly;
    expect(dc).not.toEqual(lib);
    expect(lib).toEqual({ building: buildingBounds(layout, 'BLD-LIB') });
  });

  it('moves nothing, and says why, for a building this layout does not have', () => {
    expect(cameraMove({ building: 'BLD-NOPE' }, layout)).toEqual({
      move: null,
      problem: 'The camera step names BLD-NOPE, which is not a building of this campus layout.',
    });
  });

  it('does not take an outdoor zone for a building', () => {
    const { move, problem } = cameraMove({ building: 'OUT-LAWN' }, layout);
    expect(move).toBeNull();
    expect(problem).toMatch(/OUT-LAWN.+not a building/);
  });

  it('does not change the layout it is given', () => {
    const before = structuredClone(layout);
    cameraMove({ building: 'BLD-DC' }, layout);
    expect(layout).toEqual(before);
  });
});

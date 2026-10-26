import { describe, expect, it } from 'vitest';
import { twinLayoutFixture } from '../api/fixtures/twinLayout';
import type { TwinLayoutView } from '../api/types';
import { MAX_NAMES, placementSummary } from './twinStatus';

const view = (change: (v: TwinLayoutView) => void = () => {}): TwinLayoutView => {
  const copy = structuredClone(twinLayoutFixture);
  change(copy);
  return copy;
};

describe('placementSummary', () => {
  it('counts the campus and the devices placed, and says how they were placed', () => {
    const { headline, notes } = placementSummary(
      view((v) => {
        v.placement = { placed: ['dc-env-01', 'lib-air-01'], unplaced: [], orphans: [] };
      }),
    );
    expect(headline).toBe(
      '3 zones, 2 buildings, 1 catalogue asset (not simulated) · 2 of 2 devices placed (2 illustrative)',
    );
    expect(notes).toEqual([]);
  });

  it('names a device the layout has no position for, with the reason', () => {
    const { headline, notes } = placementSummary(view());
    expect(headline).toContain('2 of 3 devices placed');
    expect(notes).toEqual(['hub-power-01: no position in the layout']);
  });

  it('counts surveyed and illustrative positions apart, only the placed ones', () => {
    const { headline } = placementSummary(
      view((v) => {
        v.layout!.devices[1]!.placement = 'surveyed';
        v.placement = {
          placed: ['dc-env-01'],
          unplaced: [{ id: 'lib-air-01', reason: 'x' }],
          orphans: [],
        };
      }),
    );
    expect(headline).toContain('1 of 2 devices placed (1 illustrative)');
    const both = placementSummary(
      view((v) => {
        v.layout!.devices[1]!.placement = 'surveyed';
        v.placement = { placed: ['dc-env-01', 'lib-air-01'], unplaced: [], orphans: [] };
      }),
    );
    expect(both.headline).toContain('(1 illustrative, 1 surveyed)');
  });

  it('spells out at most five unplaced devices and counts the rest', () => {
    const { notes } = placementSummary(
      view((v) => {
        v.placement = {
          placed: [],
          unplaced: Array.from({ length: 8 }, (_, i) => ({
            id: `d-${i}`,
            reason: 'no position in the layout',
          })),
          orphans: [],
        };
      }),
    );
    expect(MAX_NAMES).toBe(5);
    expect(notes).toHaveLength(6);
    expect(notes[0]).toBe('d-0: no position in the layout');
    expect(notes[4]).toBe('d-4: no position in the layout');
    expect(notes[5]).toBe('and 3 more not placed');
  });

  it('names the devices only the layout knows', () => {
    const { notes } = placementSummary(
      view((v) => {
        v.placement = { placed: ['dc-env-01'], unplaced: [], orphans: ['old-01', 'old-02'] };
      }),
    );
    expect(notes).toEqual(['In the layout but not in the registry: old-01, old-02']);
  });

  it('says why a layout that is not available is not, and has nothing to warn about', () => {
    const unavailable: TwinLayoutView = {
      available: false,
      reason: 'cannot read /x/twin-layout.json (ENOENT)',
      layout: null,
      placement: {
        placed: [],
        unplaced: [{ id: 'dc-env-01', reason: 'the twin layout is not available' }],
        orphans: [],
      },
    };
    expect(placementSummary(unavailable)).toEqual({
      headline: 'cannot read /x/twin-layout.json (ENOENT)',
      notes: [],
    });
    expect(placementSummary({ ...unavailable, reason: null }).headline).toBe(
      'The twin layout is not available',
    );
  });

  it('uses the singular for one of anything', () => {
    const { headline } = placementSummary(
      view((v) => {
        v.layout!.zones = [v.layout!.zones[1]!];
        v.layout!.devices = [v.layout!.devices[0]!];
        v.placement = { placed: ['dc-env-01'], unplaced: [], orphans: [] };
      }),
    );
    expect(headline).toBe(
      '1 zone, 1 building, 1 catalogue asset (not simulated) · 1 of 1 device placed (1 illustrative)',
    );
  });
});

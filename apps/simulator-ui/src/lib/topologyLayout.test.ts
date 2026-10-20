import { describe, expect, it } from 'vitest';
import { STAGE_ORDER } from './pipeline';
import {
  type Box,
  boundsOf,
  CLOSED_ZONE_H,
  COUNTS_ZONE_H,
  DEVICE_PITCH,
  devicePosition,
  edgeWidth,
  layoutZones,
  MORE_ROW,
  STAGE_BOXES,
  ZONE_GAP,
  ZONE_HEADER,
  ZONE_TOP,
  ZONE_W,
  ZONE_X,
  zoneHeight,
} from './topologyLayout';

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('zoneHeight', () => {
  it('is fixed for a closed zone and for one that shows counts', () => {
    expect(zoneHeight({ mode: 'closed', shown: 0, more: false })).toBe(CLOSED_ZONE_H);
    expect(zoneHeight({ mode: 'counts', shown: 0, more: false })).toBe(COUNTS_ZONE_H);
  });

  it('grows with the devices an open zone holds, as frame 04 draws it', () => {
    // frame 04: two devices make a 124 px zone
    expect(zoneHeight({ mode: 'open', shown: 2, more: false })).toBe(124);
    expect(zoneHeight({ mode: 'open', shown: 6, more: false })).toBe(
      ZONE_HEADER + 6 * DEVICE_PITCH + 2,
    );
  });

  it('adds a row for "+ n more"', () => {
    const plain = zoneHeight({ mode: 'open', shown: 6, more: false });
    expect(zoneHeight({ mode: 'open', shown: 6, more: true })).toBe(plain + MORE_ROW);
  });
});

describe('layoutZones', () => {
  it('stacks the zones from the top with a gap, as frame 04 does', () => {
    const boxes = layoutZones([
      { code: 'BLD-DC', mode: 'open', shown: 2, more: false },
      { code: 'BLD-LIB', mode: 'open', shown: 1, more: false },
    ]);
    expect(boxes[0]).toMatchObject({ code: 'BLD-DC', x: ZONE_X, y: ZONE_TOP, w: ZONE_W, h: 124 });
    // frame 04: the second zone starts at y = 144
    expect(boxes[1]?.y).toBe(ZONE_TOP + 124 + ZONE_GAP);
  });

  it('keeps the order it is given and gives every zone its own height', () => {
    const boxes = layoutZones([
      { code: 'A', mode: 'closed', shown: 0, more: false },
      { code: 'B', mode: 'open', shown: 3, more: true },
      { code: 'C', mode: 'counts', shown: 0, more: false },
    ]);
    expect(boxes.map((b) => b.code)).toEqual(['A', 'B', 'C']);
    expect(boxes.map((b) => b.h)).toEqual([
      CLOSED_ZONE_H,
      ZONE_HEADER + 3 * DEVICE_PITCH + 2 + MORE_ROW,
      COUNTS_ZONE_H,
    ]);
    for (let i = 1; i < boxes.length; i++) {
      const previous = boxes[i - 1] as Box;
      expect((boxes[i] as Box).y).toBe(previous.y + previous.h + ZONE_GAP);
    }
  });

  it('has nothing to lay out for no zones', () => {
    expect(layoutZones([])).toEqual([]);
  });

  it('does not move the stages: an opened zone only makes the column taller', () => {
    const before = layoutZones([{ code: 'A', mode: 'closed', shown: 0, more: false }]);
    const after = layoutZones([{ code: 'A', mode: 'open', shown: 6, more: true }]);
    expect((after[0] as Box).h).toBeGreaterThan((before[0] as Box).h);
    expect(STAGE_BOXES.broker.y).toBe(206);
  });
});

describe('devicePosition', () => {
  it('puts devices one under another, below the zone header, relative to the zone', () => {
    expect(devicePosition(0)).toEqual({ x: 14, y: ZONE_HEADER });
    expect(devicePosition(2)).toEqual({ x: 14, y: ZONE_HEADER + 2 * DEVICE_PITCH });
  });
});

describe('the stages', () => {
  const boxes = STAGE_ORDER.map((id) => STAGE_BOXES[id]);

  it('have a box each and do not overlap one another', () => {
    expect(Object.keys(STAGE_BOXES).sort()).toEqual([...STAGE_ORDER].sort());
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlap(boxes[i] as Box, boxes[j] as Box)).toBe(false);
      }
    }
  });

  it('start to the right of the zone column, so a zone never covers a stage', () => {
    for (const box of boxes) expect(box.x).toBeGreaterThan(ZONE_X + ZONE_W);
  });
});

describe('boundsOf', () => {
  it('is the smallest box that holds all of them', () => {
    expect(
      boundsOf([
        { x: 10, y: 20, w: 30, h: 40 },
        { x: 100, y: 5, w: 10, h: 10 },
      ]),
    ).toEqual({ x: 10, y: 5, w: 100, h: 55 });
  });

  it('is empty for nothing', () => {
    expect(boundsOf([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('edgeWidth', () => {
  it('is 2 for a device and grows with the devices behind a zone', () => {
    expect(edgeWidth(1)).toBe(2);
    expect(edgeWidth(2)).toBe(2.5);
    expect(edgeWidth(8)).toBe(3.5);
    expect(edgeWidth(10)).toBeGreaterThan(edgeWidth(8));
  });

  it('never passes 4, however many devices there are', () => {
    expect(edgeWidth(16)).toBe(4);
    expect(edgeWidth(1000)).toBe(4);
  });

  it('treats nothing behind an edge like one device', () => {
    expect(edgeWidth(0)).toBe(2);
  });
});

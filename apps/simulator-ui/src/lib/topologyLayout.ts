import type { StageId } from './pipeline';

/**
 * Where everything goes in the graph, worked out by hand: the shape is known (a column of zones on the left, the
 * pipeline on a fixed row beside it), so a layout library would be a second new dependency for nothing. Numbers are
 * the pixels of frame 04 at 1116 wide. React Flow zooms the whole picture, so text stays the size the CSS gives it.
 *
 * The pipeline never moves: a zone that opens makes the zone column taller, not the stages shift.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ZONE_X = 12;
export const ZONE_TOP = 8;
export const ZONE_W = 232;
export const ZONE_GAP = 12;
export const ZONE_HEADER = 30;
/** A device node sits inside its zone at this offset from the zone's left edge. */
export const DEVICE_X = 14;
export const DEVICE_W = 204;
export const DEVICE_H = 40;
export const DEVICE_PITCH = 46;
/** The "+ n more" row under the devices of a zone that shows only some of them. */
export const MORE_ROW = 28;
export const CLOSED_ZONE_H = 56;
/** A zone past 60 devices: its count and a bar of its states, nothing else. */
export const COUNTS_ZONE_H = 64;

export const STAGE_BOXES: Record<StageId, Box> = {
  broker: { x: 320, y: 206, w: 112, h: 88 },
  ingest: { x: 482, y: 206, w: 124, h: 88 },
  database: { x: 482, y: 346, w: 124, h: 64 },
  rules: { x: 656, y: 206, w: 124, h: 88 },
  alert: { x: 830, y: 206, w: 124, h: 88 },
  outbox: { x: 830, y: 346, w: 124, h: 64 },
  commandCenter: { x: 990, y: 206, w: 150, h: 88 },
};

export type ZoneMode = 'closed' | 'counts' | 'open';

/** What the layout needs to know about a zone to give it a place. */
export interface ZoneSlot {
  code: string;
  mode: ZoneMode;
  /** How many device nodes are drawn inside (an open zone only). */
  shown: number;
  /** An open zone draws "+ n more" under its devices. */
  more: boolean;
}

export interface ZoneBox extends Box {
  code: string;
}

export function zoneHeight(slot: Pick<ZoneSlot, 'mode' | 'shown' | 'more'>): number {
  switch (slot.mode) {
    case 'closed':
      return CLOSED_ZONE_H;
    case 'counts':
      return COUNTS_ZONE_H;
    case 'open':
      return ZONE_HEADER + DEVICE_PITCH * slot.shown + 2 + (slot.more ? MORE_ROW : 0);
  }
}

/** The zones stacked from the top in the order given, each with its own height. */
export function layoutZones(slots: readonly ZoneSlot[]): ZoneBox[] {
  let y = ZONE_TOP;
  return slots.map((slot) => {
    const box: ZoneBox = { code: slot.code, x: ZONE_X, y, w: ZONE_W, h: zoneHeight(slot) };
    y += box.h + ZONE_GAP;
    return box;
  });
}

/** The place of the nth device inside its zone, relative to the zone (what React Flow wants for a child). */
export function devicePosition(index: number): { x: number; y: number } {
  return { x: DEVICE_X, y: ZONE_HEADER + DEVICE_PITCH * index };
}

/** The smallest box that holds all of them; the page fits the view to it. An empty graph has an empty box. */
export function boundsOf(boxes: readonly Box[]): Box {
  const first = boxes[0];
  if (first === undefined) return { x: 0, y: 0, w: 0, h: 0 };
  let left = first.x;
  let top = first.y;
  let right = first.x + first.w;
  let bottom = first.y + first.h;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

import type { TwinLayout, TwinPlacement } from '../api/types';

/**
 * What the twin has selected: a device (a pin) or a building (its zone code). The address holds it with the keys the
 * Topology already reads, `device` and `zone`, so the _Topology | Twin_ switch carries the selection without translating
 * it and the Topology shown in place of an undrawable twin is on the same selection. A device wins over a zone.
 */
export type TwinSelection = { type: 'device'; id: string } | { type: 'zone'; id: string };

/** Whether two selections (or two hovers) are the same thing; `null` is the same as `null`. */
export function sameSelection(a: TwinSelection | null, b: TwinSelection | null): boolean {
  return a === b || (a !== null && b !== null && a.type === b.type && a.id === b.id);
}

/** The longest id read from an address; the registry's are far shorter. */
const ID_MAX_LENGTH = 100;

/** Reads the address. A value that is empty is no selection: a shared link always opens. */
export function parseTwinSelection(params: URLSearchParams): TwinSelection | null {
  const device = params.get('device');
  if (device) return { type: 'device', id: device.slice(0, ID_MAX_LENGTH) };
  const zone = params.get('zone');
  if (zone) return { type: 'zone', id: zone.slice(0, ID_MAX_LENGTH) };
  return null;
}

/**
 * The address with the selection set, or cleared. It owns `device` and `zone` and leaves every other parameter as it is:
 * the event timeline on the same page writes `page`, `size`, `range` and others in the same address.
 */
export function writeTwinSelection(
  params: URLSearchParams,
  selection: TwinSelection | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('device');
  next.delete('zone');
  if (selection !== null) next.set(selection.type, selection.id);
  return next;
}

/**
 * One step of the Escape ladder: a device climbs to the building it stands in, a building to nothing. A device the layout
 * does not place has no building to climb to, so it goes to nothing.
 */
export function climb(
  selection: TwinSelection | null,
  layout: Pick<TwinLayout, 'devices'>,
): TwinSelection | null {
  if (selection === null || selection.type === 'zone') return null;
  const device = layout.devices.find((candidate) => candidate.id === selection.id);
  return device === undefined ? null : { type: 'zone', id: device.zone };
}

/** How deep into the twin the selection puts the viewer: the whole campus, one building, or one device inside it. */
export type ViewLevel = 'campus' | 'building' | 'device';

/**
 * The building the viewer is focused on, derived from the selection and never stored: a selected building, or the
 * building a selected device stands in. `null` when nothing is selected, for a zone that is not a building, and for a
 * device the layout does not place (it has no building). So the address (`device`, `zone`) stays the only state.
 */
export function focusedZone(
  selection: TwinSelection | null,
  layout: Pick<TwinLayout, 'zones' | 'devices'>,
): string | null {
  if (selection === null) return null;
  const code =
    selection.type === 'zone'
      ? selection.id
      : layout.devices.find((candidate) => candidate.id === selection.id)?.zone;
  if (code === undefined) return null;
  return layout.zones.some((zone) => zone.code === code && zone.kind === 'building') ? code : null;
}

/** The level of the Escape ladder the selection is on; a selection that cannot be shown is the campus. */
export function levelOf(
  selection: TwinSelection | null,
  layout: Pick<TwinLayout, 'zones' | 'devices'>,
): ViewLevel {
  if (focusedZone(selection, layout) === null) return 'campus';
  return selection?.type === 'device' ? 'device' : 'building';
}

/**
 * Why a selection in the address cannot be shown, in a sentence; `null` when it can. A shared link may name a device the
 * registry no longer has, a device the layout has no position for, or a zone that is not a building.
 */
export function checkSelection(
  selection: TwinSelection | null,
  layout: Pick<TwinLayout, 'zones' | 'devices'>,
  placement: TwinPlacement,
): string | null {
  if (selection === null) return null;
  if (selection.type === 'device') {
    const registered =
      placement.placed.includes(selection.id) ||
      placement.unplaced.some((device) => device.id === selection.id);
    if (!registered) return `No device called ${selection.id} is registered.`;
    if (!layout.devices.some((device) => device.id === selection.id)) {
      return `${selection.id} has no position in the layout, so the twin cannot show it.`;
    }
    return null;
  }
  const zone = layout.zones.find((candidate) => candidate.code === selection.id);
  if (zone === undefined) return `No zone called ${selection.id} is in the layout.`;
  if (zone.kind !== 'building') return `${selection.id} is not a building in the layout.`;
  return null;
}

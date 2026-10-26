import type { TwinLayoutView } from '../api/types';

/**
 * What the twin page says about its layout, as text: how much of the campus it has and how many of the simulator's
 * devices it can place. Frame 16: a device the layout has no position for is listed, not drawn, and a warning names it,
 * so the twin never looks more certain than the data.
 */
export interface PlacementSummary {
  /** One line about the layout; for a layout that is not available, why. */
  headline: string;
  /** One line per thing worth a warning: devices without a position, devices only the layout knows. */
  notes: string[];
}

/** How many names a note spells out before it counts the rest. */
export const MAX_NAMES = 5;

const count = (n: number, singular: string, plural = `${singular}s`) =>
  `${n} ${n === 1 ? singular : plural}`;

export function placementSummary(view: TwinLayoutView): PlacementSummary {
  const { layout, placement } = view;
  if (!view.available || layout === null) {
    return { headline: view.reason ?? 'The twin layout is not available', notes: [] };
  }

  const registry = placement.placed.length + placement.unplaced.length;
  const buildings = layout.zones.filter((zone) => zone.kind === 'building').length;
  const placed = new Set(placement.placed);
  const kinds = { illustrative: 0, surveyed: 0 };
  for (const device of layout.devices) {
    if (placed.has(device.id)) kinds[device.placement] += 1;
  }
  const how = (['illustrative', 'surveyed'] as const)
    .filter((kind) => kinds[kind] > 0)
    .map((kind) => `${kinds[kind]} ${kind}`)
    .join(', ');

  const headline =
    `${count(layout.zones.length, 'zone')}, ${count(buildings, 'building')}, ` +
    `${count(layout.catalogue.length, 'catalogue asset')} (not simulated) · ` +
    `${placement.placed.length} of ${count(registry, 'device')} placed${how === '' ? '' : ` (${how})`}`;

  const notes: string[] = [];
  for (const { id, reason } of placement.unplaced.slice(0, MAX_NAMES)) {
    notes.push(`${id}: ${reason}`);
  }
  if (placement.unplaced.length > MAX_NAMES) {
    notes.push(`and ${placement.unplaced.length - MAX_NAMES} more not placed`);
  }
  if (placement.orphans.length > 0) {
    const named = placement.orphans.slice(0, MAX_NAMES).join(', ');
    const more =
      placement.orphans.length > MAX_NAMES
        ? ` and ${placement.orphans.length - MAX_NAMES} more`
        : '';
    notes.push(`In the layout but not in the registry: ${named}${more}`);
  }
  return { headline, notes };
}

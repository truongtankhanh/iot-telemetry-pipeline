/**
 * What the twin knows of the command center's asset classes: the size of the box a class stands in, and the words that
 * name it in the list "Also in this building". Nothing here imports three.js or React.
 *
 * Source: `ops-command-center`, commit `0899c86`, `docs/design/v2/asset-classes.md` (the `footprint_m` column, width ×
 * depth × height in metres, "typical outside dimensions", nothing rotated). This repository does not check it. A layout
 * file gives each asset its `class` but no size, so the table is Studio's own copy; a test that reads the real layout
 * is what notices a class that has no entry here.
 */

export interface AssetClass {
  /** Width (east–west) × depth (north–south) × height, in metres. */
  footprint: readonly [width: number, depth: number, height: number];
  singular: string;
  plural: string;
}

/** The size of a class that is not in the table: the command center's 1.4 m cube for a sensor, which stays visible. */
export const FALLBACK_FOOTPRINT: AssetClass['footprint'] = [1.4, 1.4, 1.4];

export const ASSET_CLASSES: Readonly<Record<string, AssetClass>> = {
  cooling_tower: { footprint: [4, 4, 5], singular: 'Cooling tower', plural: 'Cooling towers' },
  standby_generator: {
    footprint: [6, 2.5, 3],
    singular: 'Standby generator',
    plural: 'Standby generators',
  },
  ups: { footprint: [2, 1, 2], singular: 'UPS', plural: 'UPS units' },
  ups_battery: {
    footprint: [3, 0.8, 2],
    singular: 'UPS battery bank',
    plural: 'UPS battery banks',
  },
  precision_cooling: {
    footprint: [1.8, 0.9, 2],
    singular: 'Precision cooling unit',
    plural: 'Precision cooling units',
  },
  transformer: { footprint: [2.5, 2, 2.5], singular: 'Transformer', plural: 'Transformers' },
  switchgear: { footprint: [6, 1, 2.3], singular: 'Switchgear', plural: 'Switchgear' },
  chiller: { footprint: [6, 2, 2.5], singular: 'Chiller', plural: 'Chillers' },
  air_handler: { footprint: [4, 2, 2], singular: 'Air handler', plural: 'Air handlers' },
  booster_pump: { footprint: [1.2, 0.8, 1.2], singular: 'Booster pump', plural: 'Booster pumps' },
  lift: { footprint: [2, 2, 3], singular: 'Lift', plural: 'Lifts' },
  barrier_arm: { footprint: [4, 0.4, 1.2], singular: 'Barrier arm', plural: 'Barrier arms' },
  fume_hood: { footprint: [1.8, 0.9, 2.4], singular: 'Fume hood', plural: 'Fume hoods' },
  gas_detector: {
    footprint: [1.4, 1.4, 1.4],
    singular: 'Gas detector',
    plural: 'Gas detectors',
  },
  leak_sensor: { footprint: [1.4, 1.4, 1.4], singular: 'Leak sensor', plural: 'Leak sensors' },
  indoor_climate: {
    footprint: [1.4, 1.4, 1.4],
    singular: 'Indoor climate sensor',
    plural: 'Indoor climate sensors',
  },
};

/** The entry for a class, or `null` for one the table lacks (the caller falls back; it never throws on data). */
export function assetClass(code: string): AssetClass | null {
  return Object.hasOwn(ASSET_CLASSES, code) ? (ASSET_CLASSES[code] ?? null) : null;
}

/** The box a class stands in, or the fallback cube. */
export function footprintOfClass(code: string): AssetClass['footprint'] {
  return assetClass(code)?.footprint ?? FALLBACK_FOOTPRINT;
}

/** The words for a class, in the plural when `count` is not one; an unknown class is named by its code. */
export function classWords(code: string, count: number): string {
  const entry = assetClass(code);
  if (entry === null) return code;
  return count === 1 ? entry.singular : entry.plural;
}

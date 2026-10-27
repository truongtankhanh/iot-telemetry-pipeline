import type { TwinAsset, TwinLayout, TwinZone } from '../api/types';
import { classWords, footprintOfClass } from './twinAssetClasses';
import { sceneOf } from './twinGeometry';

/**
 * The nine catalogue assets the command center draws at campus level: the outdoor and roof equipment (cooling towers,
 * generator, transformer, switchgear, chiller, barrier arms and the Innovation Hub's roof air handler). The other 22 appear
 * there only with their building in focus. Source: `docs/design/simulator/digital-twin.md` ("The command center's
 * catalogue"), itself checked against the command center's seed and ADR-0020 on 2026-10-19.
 *
 * It is a list here and not a flag in `twin-layout.json` because the rule "outdoor and roof" cannot be read from the data
 * (a generator stands at ground level, a fume hood at 4 m is indoors); the test that reads the real layout file is what
 * notices a layout that has drifted from it.
 */
export const CAMPUS_ASSET_CODES = [
  'CT-01',
  'CT-02',
  'GEN-01',
  'TR-01',
  'SWG-01',
  'CH-01',
  'BAR-01',
  'BAR-02',
  'AHU-H1',
] as const;

export interface CampusAssets {
  /** The assets the scene draws, in the layout's order. */
  drawn: TwinAsset[];
  /** Codes of the nine that the layout does not have: reported, never dropped without a word. */
  missing: string[];
}

export function campusAssets(layout: Pick<TwinLayout, 'catalogue'>): CampusAssets {
  const wanted: ReadonlySet<string> = new Set(CAMPUS_ASSET_CODES);
  const drawn = layout.catalogue.filter((asset) => wanted.has(asset.code));
  const found = new Set(drawn.map((asset) => asset.code));
  return { drawn, missing: CAMPUS_ASSET_CODES.filter((code) => !found.has(code)) };
}

/** At campus level an asset is a mark, not a model: a cube this many metres on a side, the same for all nine. */
export const CAMPUS_MARKER_SIZE_M = 5;

/** A dashed box the scene draws for a catalogue asset, centred on `at`, with its own size. */
export interface CatalogueBox {
  code: string;
  name: string;
  class: string;
  /** [east, north] metres from the site centre. */
  at: [number, number];
  /** The height of the box's floor above the ground. */
  elevationM: number;
  /** Width (east–west) × depth (north–south) × height, in metres. */
  size: [number, number, number];
  /** Another building's asset, seen while a building is in focus: drawn dimmer. */
  faded: boolean;
}

function boxOf(asset: TwinAsset, size: [number, number, number], faded: boolean): CatalogueBox {
  return {
    code: asset.code,
    name: asset.name,
    class: asset.class,
    at: asset.at,
    elevationM: asset.elevationM,
    size,
    faded,
  };
}

/**
 * The boxes the scene draws. With no building in focus: the nine campus-level assets as cubes. With one in focus: all of
 * that building's assets at the footprint of their class, and the campus-level assets of the other buildings as dim cubes
 * (the rest of the campus fades, it does not vanish). An asset of the focused building is drawn once, at its true size.
 */
export function catalogueBoxes(
  layout: Pick<TwinLayout, 'catalogue'>,
  focusedCode: string | null,
): CatalogueBox[] {
  const cube: [number, number, number] = [
    CAMPUS_MARKER_SIZE_M,
    CAMPUS_MARKER_SIZE_M,
    CAMPUS_MARKER_SIZE_M,
  ];
  const campus = campusAssets(layout).drawn;
  if (focusedCode === null) return campus.map((asset) => boxOf(asset, [...cube], false));

  const inside = layout.catalogue.filter((asset) => asset.zone === focusedCode);
  const insideCodes = new Set(inside.map((asset) => asset.code));
  return [
    ...inside.map((asset) => {
      const [width, depth, height] = footprintOfClass(asset.class);
      return boxOf(asset, [width, depth, height], false);
    }),
    ...campus
      .filter((asset) => !insideCodes.has(asset.code))
      .map((asset) => boxOf(asset, [...cube], true)),
  ];
}

/** Where a box's label hangs, in scene metres: over the middle of its top face. */
export function labelAnchor(
  box: Pick<CatalogueBox, 'at' | 'elevationM' | 'size'>,
): [number, number, number] {
  return sceneOf(box.at[0], box.at[1], box.elevationM + box.size[2]);
}

/** One row of "Also in this building": the assets of one class, the words for it and where they stand. */
export interface AssetGroup {
  class: string;
  codes: string[];
  /** "Cooling towers", or "Standby generator" for one. */
  label: string;
  /** "roof", "3 m east" and the like when every asset of the group stands there; `null` otherwise. */
  where: string | null;
}

/** Whole metres, at least 1 (an asset 0.4 m outside the wall is "1 m"). */
const wholeMetres = (metres: number) => Math.max(1, Math.round(metres));

/**
 * Where an asset stands against its building, in words the data supports: "roof" when its floor is at the building's
 * height, "N m east/west/north/south" when it stands outside the zone's box (by the larger overshoot), else `null`.
 */
function placeOf(asset: TwinAsset, zone: TwinZone): string | null {
  if (zone.heightM !== undefined && zone.heightM > 0 && asset.elevationM === zone.heightM) {
    return 'roof';
  }
  const dx = asset.at[0] - zone.at[0];
  const dy = asset.at[1] - zone.at[1];
  const overEast = Math.abs(dx) - zone.size[0] / 2;
  const overNorth = Math.abs(dy) - zone.size[1] / 2;
  if (overEast <= 0 && overNorth <= 0) return null;
  if (overEast >= overNorth) return `${wholeMetres(overEast)} m ${dx > 0 ? 'east' : 'west'}`;
  return `${wholeMetres(overNorth)} m ${dy > 0 ? 'north' : 'south'}`;
}

/**
 * What stands in a building, grouped by class in the order the layout lists them (one row per class: no rule to merge
 * a UPS and its battery). An unknown building has no groups.
 */
export function assetGroups(
  layout: Pick<TwinLayout, 'zones' | 'catalogue'>,
  zoneCode: string,
): AssetGroup[] {
  const zone = layout.zones.find((candidate) => candidate.code === zoneCode);
  if (zone === undefined) return [];
  const byClass = new Map<string, TwinAsset[]>();
  for (const asset of layout.catalogue) {
    if (asset.zone !== zoneCode) continue;
    byClass.set(asset.class, [...(byClass.get(asset.class) ?? []), asset]);
  }
  return [...byClass].map(([className, assets]) => {
    const places = new Set(assets.map((asset) => placeOf(asset, zone)));
    const [only] = places;
    return {
      class: className,
      codes: assets.map((asset) => asset.code),
      label: classWords(className, assets.length),
      where: places.size === 1 && only !== undefined ? only : null,
    };
  });
}

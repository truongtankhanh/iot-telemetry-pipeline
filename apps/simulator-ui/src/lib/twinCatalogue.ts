import type { TwinAsset, TwinLayout } from '../api/types';

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

import type { TwinLayoutView } from '../types';
import raw from './twin-layout.json';

/**
 * `twin-layout.json` (a trimmed `GET /api/twin-layout` body: two buildings with the Data Center's real numbers, a lawn,
 * two devices placed and one the layout has no position for) typed as the view, for tests. The JSON reads its `[east, north]`
 * pairs as `number[]`, not a tuple, so the cast goes through `unknown` once, here, as `stateView.ts` does; a test clones it
 * before changing anything.
 */
export const twinLayoutFixture = raw as unknown as TwinLayoutView;

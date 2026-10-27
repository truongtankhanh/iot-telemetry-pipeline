import type { TwinLayout } from '../api/types';
import type { DemoCamera } from './demoScript';
import type { CameraTarget } from './twinCamera';
import { buildingBounds } from './twinGeometry';
import type { TwinSelection } from './twinQuery';

/**
 * What a guided-demo step's camera does to the twin (SIM-21): where the camera flies and what the selection becomes. Nothing here
 * imports three.js or React. The focus on a building is derived from the selection, so a step that shows a building must select it,
 * or the scene would fly to it and leave the rest of the campus unfaded.
 */
export interface CameraMove {
  fly: CameraTarget;
  /** The selection the step makes: `null` clears it, `undefined` leaves it as the viewer had it. */
  select: TwinSelection | null | undefined;
}

export interface CameraMoveResult {
  /** `null` when the step names something this layout does not have: nothing moves. */
  move: CameraMove | null;
  /** Why nothing moves, in a sentence for the presenter; `null` when something does. */
  problem: string | null;
}

/**
 * - `campus`: the whole campus, and no selection (the level goes back up with the camera);
 * - `top`: overhead, and the selection stays;
 * - `{ building }`: that building's view, and the building selected. A code that is not a building of the layout moves nothing and
 *   says so.
 */
export function cameraMove(
  camera: DemoCamera,
  layout: Pick<TwinLayout, 'zones' | 'catalogue'>,
): CameraMoveResult {
  if (camera === 'campus') return { move: { fly: 'campus', select: null }, problem: null };
  if (camera === 'top') return { move: { fly: 'top', select: undefined }, problem: null };
  const bounds = buildingBounds(layout, camera.building);
  if (bounds === null) {
    return {
      move: null,
      problem: `The camera step names ${camera.building}, which is not a building of this campus layout.`,
    };
  }
  return {
    move: { fly: { building: bounds }, select: { type: 'zone', id: camera.building } },
    problem: null,
  };
}

import type { StateView } from '../types';
import raw from './state-view.json';

/**
 * `state-view.json` (a real `GET /api/state` body) typed as the state view, for tests. A direct `as StateView`
 * on the imported JSON does not compile: TypeScript reads the metric samples, whose labels differ from one
 * sample to the next, as a union with `?: undefined` keys, which is not a `Record<string, string>`. The keys are
 * checked, from both sides, by `client.test.ts` and by `apps/simulator/src/control-routes.test.ts`, so the
 * cast through `unknown` is made once, here, and a test imports this and clones it before changing anything.
 */
export const stateViewFixture = raw as unknown as StateView;

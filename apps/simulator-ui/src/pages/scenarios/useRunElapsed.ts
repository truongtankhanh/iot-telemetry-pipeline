import { runFor, scenarioElapsedS } from '../../lib/runClock';
import { useNow } from '../../state/useNow';
import { useStudio } from '../../state/studioContext';

/**
 * Seconds into the run of a scenario, ticking once a second, or `null` when it is not playing. Only a component that is
 * drawn while a scenario plays should call it (the playhead): it owns a one-second timer, so a card that is not running
 * has none and the list does not render every second. It reads the engine and the runs, which keep the same identity
 * when only another slice of the state (alerts, metrics) is refreshed.
 */
export function useRunElapsed(scenario: string, lengthS: number): number | null {
  const runs = useStudio((state) => state.view?.runs);
  const engine = useStudio((state) => state.view?.engine);
  const now = useNow(1000);
  const run = runs === undefined ? undefined : runFor(runs, scenario);
  if (run === undefined || engine === undefined) return null;
  return scenarioElapsedS(run, engine, now, lengthS);
}

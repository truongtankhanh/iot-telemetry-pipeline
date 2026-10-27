import { metricUnit } from './deviceIdentity';
import { FAULT_TILES, type FaultDraft, type FaultPlan, type FaultTileInfo } from './labFault';
import { DEFAULT_LAB_QUERY, writeLabQuery } from './labQuery';
import { formatValue } from './rules';
import { seconds } from './scenarioExpectation';

/**
 * The words and the link of the twin's "Inject here" card (SIM-21; frames 14 and 15), as pure functions. The card sends nothing of
 * its own: its plan is the Lab's (`planFault`) and its send is the Lab's (`useInjection`), so what is here is only what the card
 * says around them.
 */

/** The five chips of the frames, in their order. The Lab has nine tiles; the frames draw these five. */
const INJECT_TILE_IDS = ['breach', 'silent', 'drop', 'delay', 'malformed'] as const;

/**
 * The chips, taken from the Lab's own list so that what each can do, and why a chip cannot be chosen, is the Lab's word and not a
 * copy of it: only Breach is a timed fault the Lab sends; the others say where to set them.
 */
export const INJECT_TILES: readonly FaultTileInfo[] = INJECT_TILE_IDS.flatMap((id) =>
  FAULT_TILES.filter((tile) => tile.id === id),
);

/** "Starts now", "Starts in 20 s"; nothing while the field is empty (the plan's error says so). */
export function startsInSentence(draft: Pick<FaultDraft, 'startAt'>): string | null {
  const { startAt } = draft;
  if (startAt === null || !Number.isFinite(startAt) || startAt < 0) return null;
  return startAt === 0 ? 'Starts now' : `Starts in ${seconds(startAt)}`;
}

/** "Breach temperature_c → 29.2 °C for 60 s": what pressing the button sends. `null` while the plan has no metric or value. */
export function injectionSentence(
  plan: Pick<FaultPlan, 'metric' | 'value'>,
  draft: Pick<FaultDraft, 'duration' | 'stop'>,
): string | null {
  const { metric, value } = plan;
  if (metric === null || value === null) return null;
  const unit = metricUnit(metric);
  const reading = `${formatValue(metric, value)}${unit === '' ? '' : ` ${unit}`}`;
  const length =
    draft.stop === 'manual' || draft.duration === null ? '' : ` for ${seconds(draft.duration)}`;
  return `Breach ${metric} → ${reading}${length}`;
}

/** The Lab, with this device chosen as its target. The form's values (value, times) are the Lab's page state and do not travel. */
export function labLink(deviceId: string): string {
  const params = writeLabQuery(new URLSearchParams(), {
    ...DEFAULT_LAB_QUERY,
    scope: 'device',
    targets: [deviceId],
  });
  const query = params.toString();
  return query === '' ? '/lab' : `/lab?${query}`;
}

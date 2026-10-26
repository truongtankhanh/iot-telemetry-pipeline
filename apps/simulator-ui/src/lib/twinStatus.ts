import type { TwinLayoutView } from '../api/types';
import { CONTEXT_GRACE_MS } from './webgl';

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

/** Why the twin is not drawn (frame 16's table). Each says what Studio shows instead. */
export type FallbackReason =
  | { kind: 'no-webgl2' }
  /** The read of the layout failed; `message` is the simulator's, or Studio's "too old for the twin". */
  | { kind: 'layout-error'; message: string }
  /** The simulator answered, and could not use its layout file. */
  | { kind: 'layout-unavailable'; reason: string | null }
  | { kind: 'context-lost' }
  /** The scene's code did not load (a stale hash after a rebuild, a network drop). */
  | { kind: 'code-not-loaded' };

/** What can go wrong inside the scene once the page decided to draw it: the page then shows the fallback. */
export type SceneProblem = Extract<FallbackReason['kind'], 'context-lost' | 'code-not-loaded'>;

export interface FallbackNotice {
  /** `info` explains (this device cannot draw it); `warn` asks for a look (the layout or the scene failed). */
  tone: 'info' | 'warn';
  title: string;
  message: string;
  /** A failed read can be tried again; the others cannot be helped by trying. */
  retry: boolean;
}

const SHOWS_TOPOLOGY = 'Studio shows the topology instead.';
const INSTEAD = `${SHOWS_TOPOLOGY} Every value is the same.`;

/** The words of the banner for a reason: what happened, and that every value is still on the Topology. */
export function fallbackNotice(reason: FallbackReason): FallbackNotice {
  switch (reason.kind) {
    case 'no-webgl2':
      return {
        tone: 'info',
        title: "3D view isn't available on this device.",
        message: `WebGL 2 is off, so ${INSTEAD}`,
        retry: false,
      };
    case 'layout-error':
      return {
        tone: 'warn',
        title: 'The twin layout could not be read.',
        message: `${reason.message} ${INSTEAD}`.trim(),
        retry: true,
      };
    case 'layout-unavailable':
      return {
        tone: 'warn',
        title: 'The twin layout is not available.',
        message: `${reason.reason ?? 'The simulator sent none.'} ${INSTEAD}`,
        retry: false,
      };
    case 'context-lost':
      return {
        tone: 'warn',
        title: 'The 3D view lost its graphics context.',
        message: `It did not come back within ${CONTEXT_GRACE_MS / 1000} seconds, so ${INSTEAD}`,
        retry: false,
      };
    case 'code-not-loaded':
      return {
        tone: 'warn',
        title: 'The 3D code could not be loaded.',
        message:
          'Reload the page to try again; until then Studio shows the topology, where every value is the same.',
        retry: false,
      };
  }
}

export interface LoadingStep {
  id: 'plan' | 'devices' | 'code' | 'shells';
  label: string;
  state: 'done' | 'loading' | 'waiting';
  /** The word beside the step: a state is never an icon alone. */
  word: 'ready' | 'loading' | 'waiting';
}

/**
 * The checklist of the loading card (frame 16): the plan and the device layout are already here, the 3D code is on its
 * way, the shells wait for it. There is no percentage: a dynamic `import()` reports no progress, and a bar that moved
 * would be made up.
 */
export function loadingSteps(counts: { zones: number; devices: number }): LoadingStep[] {
  return [
    {
      id: 'plan',
      label: `Site plan, ${count(counts.zones, 'zone')}`,
      state: 'done',
      word: 'ready',
    },
    {
      id: 'devices',
      label: `Device layout, ${count(counts.devices, 'device')}`,
      state: 'done',
      word: 'ready',
    },
    { id: 'code', label: '3D code', state: 'loading', word: 'loading' },
    { id: 'shells', label: 'Building shells', state: 'waiting', word: 'waiting' },
  ];
}

import type { Severity } from '../api/types';
import type { TopologyState } from '../lib/topologyState';
import type { ArcLook } from '../lib/twinFlow';

/**
 * The scene's colours, as numbers a WebGL material takes (a shader cannot read a CSS variable, and the spike draws
 * nothing in the DOM that would use one). They are the command center's (`--tw-*` in its `tokens.css`, ADR-0020),
 * as ADR-0012 decision 2 says: one neutral material. Frame 14's own stylesheet differs a little on three of them
 * (top `#2a4658`, edge `#46627a`, ground `#0d1d29`); the command center's win, so the two twins look alike.
 *
 * The south and east faces have no colour of their own: they come from the lights (`TwinScene`), tuned to give
 * the command center's `--tw-south` `#1f3748` and `--tw-east` `#172b3a` from the top colour.
 */
export const twinColors = {
  /** A building's colour, and what the lights shade into its walls. */
  top: 0x274152,
  /** The outline of a building and of the site boundary. */
  edge: 0x3e5a6e,
  /** The plane under the campus. */
  ground: 0x0f1d27,
  /** Behind everything: Studio's `--surface-0`, a copy that `scripts/contrast.ts --check` keeps honest for the page. */
  background: 0x08131d,
} as const;

/**
 * The look of a state in the scene, as numbers (the tokens a shader cannot read): the pin's ring and the building's rim.
 * `healthy` is `--success`, `anomaly` `--warning`, `down` `--danger`, `selected` `--accent`; `stale` (paused, stopped,
 * silent) is frame 14's grey `#6b7c87`, a dim neutral that is neither a token nor a status colour.
 */
export const stateColors: Record<TopologyState | 'selected', number> = {
  healthy: 0x3df0ae,
  anomaly: 0xffc23d,
  down: 0xff6280,
  stale: 0x6b7c87,
  selected: 0x959bff,
};

/**
 * The top face of a building in an alarming or dark state. The command center's neutral material has no such tints;
 * these are frame 14's (`--tw-warn-top`, `--tw-stale-top`), kept until its V3 review says otherwise. The walls take
 * their shade from the lights, as they do for the neutral top, so only the top colour is named.
 */
export const buildingTints = {
  warnTop: 0x5b4e34,
  staleTop: 0x2b3338,
} as const;

/** The fill of a pin: Studio's `--surface-1`, and frame 14's `#3d3523` under an anomaly. */
export const pinFills = { normal: 0x10212d, anomaly: 0x3d3523 } as const;

/** A pin's stem down to the roof: Studio's `--text-tertiary`. */
export const stemColor = 0x91a5b4;

/** A catalogue marker: frame 14's `#8aa0af`, dimmed by the material's opacity. */
export const markerColor = 0x8aa0af;

/**
 * The rest of the campus while one building is in focus: the command center's `--tw-ghost-opacity` (0.18). Frame 14's
 * `.is-ghost` says 0.22; the command center's wins, as for the neutral material. Applies to the other buildings, their
 * pins, stems and arcs and the other catalogue markers; a beacon never fades.
 */
export const ghostOpacity = 0.18;

/**
 * The hatch of a floor that has no temperature to show (a building with no temperature device, or none reporting): frame 15's
 * `hatchm` pattern, 45° lines in `#5a7488` at 35 %. A shape, not a colour: it says "nothing measured" where a tint would
 * say "cold". The ramp itself is in `lib/twinHeat.ts` (the cells arrive coloured).
 */
export const heatHatch = { color: 0x5a7488, opacity: 0.35 } as const;

/**
 * The building in focus (frame 15). Its walls are see-through at one opacity (the frame's far walls are 0.30 and its near
 * walls 0.10, which would need the walls re-ordered whenever the camera moves; one value in between needs nothing), its
 * roof is not drawn, and the floor is an opaque base under the heat: frame 15's floor `#0f2230`.
 */
export const focusColors = {
  wallOpacity: 0.16,
  floor: 0x0f2230,
} as const;

/** The top colour of a building by its worst device: the neutral top for none or healthy, a tint otherwise. */
export function buildingTop(state: TopologyState | null): number {
  if (state === 'anomaly' || state === 'down') return buildingTints.warnTop;
  if (state === 'stale') return buildingTints.staleTop;
  return twinColors.top;
}

/** The colour of a building's outline: its worst state, or the neutral edge for a building with no device. */
export function rimColor(state: TopologyState | null): number {
  return state === null ? twinColors.edge : stateColors[state];
}

/**
 * The beacon of an open alert, by the alert's severity: `--sev-critical`, `--sev-high`, `--sev-medium`, `--sev-low`. The
 * only loud colours in Studio, and they mean severity and nothing else, so a beacon is never `--warning`.
 */
export const severityColors: Record<Severity, number> = {
  critical: 0xff6280,
  high: 0xff8f3a,
  medium: 0xffe04d,
  low: 0x44d2ff,
};

/**
 * The arcs of the data flow, by look: `flowing` is `--flow` (electric cyan, energy moving), `warn` `--warning`, `bad`
 * `--danger`, and `off` the dim neutral of `stateColors.stale`. Topology's edges use the same four hues for the same words.
 */
export const arcColors: Record<ArcLook, number> = {
  flowing: 0x47d7ff,
  warn: 0xffc23d,
  off: 0x6b7c87,
  bad: 0xff6280,
};

/** The lit core of a dot on a `flowing` and a `warn` arc: `--flow-core` and `--warn-core`. */
export const dotColors = { flowing: 0xd8f6ff, warn: 0xfff3d6 } as const;

/** The logical hub: `--accent`, the colour of what can be acted on, drawn dashed because the hub is not a place. */
export const hubColor = 0x959bff;

/** The cross on the hub: red while the pipeline is down (`--danger`), amber for a malformed fault (`--warning`). */
export const crossColors = { down: 0xff6280, malformed: 0xffc23d } as const;

import type { TopologyState } from '../lib/topologyState';

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

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

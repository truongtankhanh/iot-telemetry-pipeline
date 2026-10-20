# Simulator Studio (`@itp/simulator-ui`)

The web UI of the simulator's control plane ([ADR-0011](../../docs/adr/0011-simulator-studio-control-plane.md)). It is built to
static files that the simulator's control server serves at `/`, so there is one process, one origin and no CORS. The design is in
[`docs/design/simulator/`](../../docs/design/simulator/); this package implements it page by page (SIM-04 is the shell).

**A V1 demo, not for production.** The control API it talks to has no authentication
([operations.md](../../docs/operations.md#security-posture)).

## Run it

With the simulator running (it serves the API on `:3200`):

```bash
pnpm --filter @itp/simulator start                  # the engine and the control server
pnpm --filter @itp/simulator-ui dev                 # Vite on :5173, proxying /api (the event stream too) to :3200
```

`STUDIO_API_URL` moves the proxy target. Without the dev server, build once and let the simulator serve it:

```bash
pnpm --filter @itp/simulator-ui build               # tsc, then vite build into dist/
pnpm --filter @itp/simulator start                  # now also serves http://localhost:3200
```

The whole demo in containers is `pnpm docker:demo`; Studio is then at `http://localhost:3200` (`STUDIO_HOST_PORT`).
No other script needs the UI built: a simulator without `dist/` runs, and says how to build it.

## Check it

```bash
pnpm --filter @itp/simulator-ui test        # Vitest, jsdom
pnpm --filter @itp/simulator-ui lint        # ESLint, then the contrast check (scripts/contrast.ts --check)
pnpm --filter @itp/simulator-ui typecheck   # src and the Node-side scripts
```

Tests sit next to the code (`*.test.ts(x)`); the checks of the stylesheets are in `scripts/` and read the files from disk, because
jsdom computes no CSS. The state shape the UI is written against is `src/api/fixtures/state-view.json`; a test in `apps/simulator`
fails when the server's `StateView` and that file drift apart.

## Layout

| Path               | What is there                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`      | The store, the stream and the router (`App`), and the frame inside them (`StudioFrame`)                                                                                               |
| `src/shell/`       | Header, navigation, the lost-link banner, the pills                                                                                                                                   |
| `src/palette/`     | The command palette (⌘ K, `/`)                                                                                                                                                        |
| `src/pages/`       | One file per page; `NotBuilt` is the placeholder of a page whose ticket has not landed                                                                                                |
| `src/pages/fleet/` | The Fleet: cards, table, bulk bar, inspector, hold dialog, and the hooks behind them (`useFleetParams` for the address, `useFleetRows`, `useDeviceCommands`, `useBulkRun`)            |
| `src/ui/charts/`   | Line chart, sparkline and range bar in hand-written SVG                                                                                                                               |
| `src/state/`       | One vanilla Zustand store per window, the event-stream connection, the React context, and `history.ts`, the last two minutes of readings (outside React: nothing renders per message) |
| `src/api/`         | Types of the control API, the fetch client, the fixture                                                                                                                               |
| `src/ui/`          | The shared components (pills, chips, buttons, tables, device badge, data line); icons only via `icons.ts`                                                                             |
| `src/lib/`         | Pure logic with tests: routes, shortcuts, palette matching, pill derivation, animation budget, preferences                                                                            |
| `src/styles/`      | `tokens.css` (the only place a colour, size or timing is defined) and `base.css`                                                                                                      |
| `scripts/`         | `contrast.ts` (every text and state colour pair against its surface) and `textSize.ts` (13 px minimum)                                                                                |

## Rules the code keeps

- **Tokens only.** A component's CSS Module uses `var(--…)` from `tokens.css`; the names are the command center's, so adopting its
  values is a change of `:root`. `pnpm lint` fails when a pair of colours drops below its contrast ratio.
- **State is never colour alone**: an icon, a word and a border style go with it (`Pill`, `NodeState`, `SeverityBadge`).
- **Smallest text is 13 px** (`scripts/textSize.ts`). Only numerals of 24 px and up glow.
- **Motion is capped** by `AnimationBudget`: 12 animated nodes and 24 glowing lines at a time. The cap is checked in tests, and
  `prefers-reduced-motion` turns the motion off in one block of `tokens.css`. Keyframes live in the component's CSS Module.
- **The address is the state of a list page** (the Fleet's search, filters, sort, page, size and open device), parsed with a fallback to the default and written without what is default.
- **No page renders per message.** `published` events feed a rate; a page that needs messages reads the stream itself.
- **Wall screens**: from 1600 px the navigation is an icon rail, and the whole UI scales ×1.25 at 2560 px and ×1.5 at 3200 px.
- **Fonts are Latin, Latin Extended and Vietnamese, WOFF2 only** (`src/styles/fonts.css`). The per-subset files of `@fontsource` carry no
  `unicode-range`, so each face is declared there with the range of fontsource's own stylesheet; do not import `@fontsource/*/<subset>-<weight>.css`
  directly. A new language adds its subset to that file. Nothing is fetched from a font host.
- **Foundations** (`/foundations`, frame 00) exists in development and tests, and in a production build only with
  `VITE_STUDIO_FOUNDATIONS=true`.

## Add a page

1. Give its route the `built: true` flag in `src/lib/routes.ts` (the path, label, ticket and `g` key are already there).
2. Write `src/pages/<Name>.tsx` from `PageHeader` and `Card`, reading the store with `useStudio(selector)`.
3. Add its `<Route>` in `Pages` in `src/App.tsx`; a page not yet built keeps opening `NotBuilt`.
4. Add its tests beside it; the palette and the navigation pick the route up from `routes.ts`.

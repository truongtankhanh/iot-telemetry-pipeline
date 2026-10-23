# Simulator Studio (`@itp/simulator-ui`)

The web UI of the simulator's control plane ([ADR-0011](../../docs/adr/0011-simulator-studio-control-plane.md)). It is built to
static files that the simulator's control server serves at `/`, so there is one process, one origin and no CORS. The design is in
[`docs/design/simulator/`](../../docs/design/simulator/); this package implements it page by page (SIM-04 is the shell).

**A V1 demo, not for production.** The control API it talks to has no authentication
([operations.md](../../docs/operations.md#security-posture)).

## Run it

**The shortest way:** the demo in containers gives Studio everything it reads (PostgreSQL, Mosquitto, ingest and a
simulator that serves the API on `:3200`), and Vite adds hot reload:

```bash
pnpm docker:demo                                    # terminal 1: the whole demo, foreground (Ctrl+C stops it)
pnpm --filter @itp/simulator-ui dev                 # terminal 2: Vite on :5173, proxying /api (the event stream too) to :3200
```

Open <http://localhost:5173>. `STUDIO_API_URL` moves the proxy target. The Studio the demo serves itself at `:3200`
is the build baked into the simulator image. [docs/development.md](../../docs/development.md#run-it-locally) has the
variant with ingest and the simulator on the host, and why the two must not run together.

**Without the dev server,** build once and let a simulator serve it:

```bash
pnpm --filter @itp/simulator-ui build               # tsc, then vite build into dist/
pnpm --filter @itp/simulator start                  # also serves http://localhost:3200 (after pnpm docker:up and an ingest)
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
fails when the server's `StateView` and that file drift apart. The scenario library read has the same arrangement with
`src/api/fixtures/scenarios.json`, and the observation log read (`GET /api/observations`) with `src/api/fixtures/observations.json`.

## Layout

| Path                   | What is there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/App.tsx`          | The store, the stream and the router (`App`), and the frame inside them (`StudioFrame`)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/shell/`           | Header, navigation, the lost-link banner, the pills, the Lab's switcher (`LabSwitcher`), the "Faults on" pill (`FaultsPill`)                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/palette/`         | The command palette (⌘ K, `/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/pages/`           | One file per page; `NotBuilt` is the placeholder of a page whose ticket has not landed                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/pages/fleet/`     | The Fleet: cards, table, bulk bar, inspector, hold dialog, and the hooks behind them (`useFleetParams` for the address, `useFleetRows`, `useDeviceCommands`, `useBulkRun`)                                                                                                                                                                                                                                                                                                                                               |
| `src/pages/topology/`  | The Topology: the graph (React Flow: nodes, zones, the neon edge, the dots), the toolbar, the key, the row under it (device, rule evaluation, alerts; a stage; a zone), the dependency-down banners and checks                                                                                                                                                                                                                                                                                                           |
| `src/pages/scenarios/` | The Lab's Scenarios: the cards (what a scenario does to the rules, Run and Stop), the chart (value or lanes), the replace and delete dialogs, the import, Edit / Duplicate / Export / Delete and the dashed New scenario card, and the hooks behind them (`useScenariosParams` for the address, `useScenarioLibrary` for the library read, `useScenarioCommands`, `useRunElapsed`)                                                                                                                                       |
| `src/pages/alerts/`    | The Alerts: the list and its cursor pager, the detail with its "why" and delivery trail, and the hooks behind them (`useAlertsParams` for the address, `useAlertsPage` for the page asked of the simulator)                                                                                                                                                                                                                                                                                                              |
| `src/pages/overview/`  | The Overview (`src/pages/Overview.tsx` is the thin page): the key figures, the alert feed, the controls with the progress of a scenario (Run, Stop, Pause, Step, Reset), the live topology (the Topology's own nodes, in a shorter canvas), and the event timeline (filter, range, strip, pages, export), with the hooks behind them (`useOverviewParams` for the address, `useOverviewKpis`, `useSimulationControls`, `useEventTimeline`)                                                                               |
| `src/pages/lab/`       | The Simulation lab (frames 12 and 19): the configuration (targets, the fault, the stop condition), the canvas (the Topology's graph with the targets marked; above 60 devices a zone list, the pipeline and a zone table), the execution inspector (log, target, rule evaluation, trace), the expected-impact strip, the active faults, and the bar and the timeline dock under them, with the hooks behind them (`useLabParams` for the address, `useLabFault`, `useExpectedImpact`, `useInjection`, `useLabInspector`) |
| `src/pages/timeline/`  | The timeline editor (frame 05): the header (name, description, Discard, Save, Run now, Export, Delete), the canvas (the Lab's drawing with selection, grips, snap, windows, zones that open, the alerts rows), the inspector (fields, shape, the preview against the thresholds), the expected-alerts table, and the hooks behind them (`useTimelineParams` for the address, `useScenarioEditor` for the working copy and its edits, `useEditorCommands` for save, run and delete, `usePointerEdit` for the drag)        |
| `src/pages/faults/`    | The Lab's Faults (frame 07): the scope (the Lab's picker), the seven faults with a switch and the settings of each while it is on, the amber banner, Clear all faults and Reset counters, the effect panel (the change of ingest's counters since the faults went on), and the hooks behind them (`useFaultDrafts` for the values being edited, `useFaultCommands`)                                                                                                                                                      |
| `src/ui/charts/`       | Line chart, sparkline and range bar in hand-written SVG                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/state/`           | One vanilla Zustand store per window, the event-stream connection, the React context, `editorDrafts.ts`, the timeline editor's working copies kept outside React for the session, and `history.ts`, the last two minutes of readings, and `observationLog.ts`, the simulator's last 5,000 observations (both outside React: nothing renders per message)                                                                                                                                                                 |
| `src/api/`             | Types of the control API, the fetch client, the fixture                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/ui/`              | The shared components (pills, chips, buttons, tables, device badge, data line); icons only via `icons.ts`                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/lib/`             | Pure logic with tests: routes, shortcuts, palette matching, pill derivation, animation budget, preferences                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/styles/`          | `tokens.css` (the only place a colour, size or timing is defined) and `base.css`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `scripts/`             | `contrast.ts` (every text and state colour pair against its surface) and `textSize.ts` (13 px minimum)                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Rules the code keeps

- **Tokens only.** A component's CSS Module uses `var(--…)` from `tokens.css`; the names are the command center's, so adopting its
  values is a change of `:root`. `pnpm lint` fails when a pair of colours drops below its contrast ratio.
- **State is never colour alone**: an icon, a word and a border style go with it (`Pill`, `NodeState`, `SeverityBadge`).
- **Smallest text is 13 px** (`scripts/textSize.ts`). Only numerals of 24 px and up glow.
- **Motion is capped** by `AnimationBudget`: 12 animated nodes and 24 glowing lines at a time. The cap is checked in tests, and
  `prefers-reduced-motion` turns the motion off in one block of `tokens.css`. Keyframes live in the component's CSS Module.
- **The address is the state of a list page** (the Fleet's search, filters, sort, page, size and open device), parsed with a fallback to the default and written without what is default.
- **A cursor is a value the API handed out, kept in memory and handed back unchanged** (`lib/cursorPaging.ts`): the Alerts never builds, reads or edits one, and keeps it out of the address, so a reload opens the newest alerts.
- **No page renders per message.** `published` events feed a rate, the history and the pulse bus; a page that needs messages reads the stream itself.
- **The graph is derived from the store, never the other way round** (`lib/topology.ts` builds it as data; `Stable` keeps the same object for every node that did not change). The address holds the search, the grouping, _Problems only_ and the selection. Graph drawn with [React Flow](https://reactflow.dev) (MIT), credited in the page's key.
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

# ADR-0011: Simulator Studio is a control plane inside the simulator process

- **Status:** Accepted 2026-10-19 (SIM-00; the design review, the light-theme and port answers are in the [brief](../design/simulator/brief.md#open-questions))
- **Date:** 2026-10-19

## Context

The simulator ([apps/simulator](../../apps/simulator/README.md)) is a command-line script. A demo that needs a
different scenario, a stopped device or a new anomaly means stopping it and starting it with other flags, which is
slow and looks improvised. We want a web UI (the [design brief](../design/simulator/brief.md)) that does all of that
live and also shows what the pipeline did with the traffic.

A browser cannot speak MQTT over TCP. The UI therefore needs something that publishes on its behalf, or a broker
that accepts MQTT over WebSocket.

Constraints that shape the choice:

- The repository is a V1 demo; the broker is anonymous and the API is open on purpose
  ([operations.md](../operations.md#security-posture)). Studio must not change that as a side effect.
- `main.ts`, `bench.ts` and `pnpm docker:demo` must keep working without a UI.
- [V2-T05](../tasks/v2/V2-T05-simulator-replaces-occ-telemetry-sim.md) will replace the hand-written `devices.json`
  list with the command center's catalogue. The UI should not have to change when it does.
- ops-command-center will refresh its UI after its V2; Studio is shown beside it.

## Decision

1. **The engine stays in the simulator's Node process.** The loop in `main.ts` becomes a module (devices, signals,
   anomalies, faults, a publish log) that can be changed while it runs and emits events. `main.ts` and `bench.ts`
   call it; they stay the headless entry points.
2. **A small HTTP server in that process is the control plane.** JSON commands for devices, scenarios, faults and
   the benchmark, and one server-sent-events stream for state and the publish log. It also serves the built UI as
   static files.
3. **Studio reads consequences from ingest through the same process**, not from the browser. The engine process
   polls `GET /api/alerts`, `GET /api/ready` and `/metrics` and forwards what changed on the event stream. Ingest is
   not modified and needs no CORS configuration.
4. **The UI is its own workspace package** (`apps/simulator-ui`, React and Vite, built to static files) so the
   simulator keeps its no-build-step property. It uses Vitest, as `packages/telemetry-contract` already does; this
   does not add a fourth runner.
5. **The device list comes through a `DeviceSource` interface.** Today it reads `devices.json`; V2-T05 adds the
   catalogue source. The UI only sees devices.
6. **Design tokens use the command center's names** so a refresh of that console is a change of values.
7. **Safe by default:** the control server binds `127.0.0.1`; in Compose its port is published on `127.0.0.1` only.

## Alternatives considered

| Option                                       | Why not                                                                                                                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser connects to Mosquitto over WebSocket | The simulation logic would live in a browser tab: the CLI, the benchmark and the headless demo could not share it, a closed tab stops the demo, and the broker configuration would change (a WebSocket listener) in every place it is defined. |
| Add the control plane to the ingest service  | Ingest is the product; a demo tool must not be able to break it, and the simulator would need ingest to run in order to publish. The two are deliberately independent.                                                                         |
| A third service for Studio                   | Adds a process, a port and a Compose entry for logic that is the simulator's own state. Nothing needs it separate.                                                                                                                             |
| UI polls ingest directly from the browser    | Needs CORS on an API that is intentionally network-only, and gives the browser two origins to reconcile.                                                                                                                                       |
| Rebuild the simulator UI on Angular          | The command center is React; sharing tokens and, later, components is easier in the same stack, and the UI is a demo surface rather than an application the team will maintain long term.                                                      |

## Consequences

- The simulator gains a long-lived HTTP server and an unauthenticated control surface. This is accepted for V1 and
  documented in [Security posture](../design/simulator/brief.md#security-posture); it is **not** acceptable
  outside a demo, and the design says what promotion would need.
- The engine refactor is the riskiest ticket (SIM-02): behaviour of the existing CLI must not change, so it is
  covered by tests first.
- Anomaly shapes other than a step (ramp, spike) and faults (drop, duplicate, delay, malformed) are new engine
  features, not UI features; they get unit tests next to `signals.ts`.
- Because "expected alerts" are computed from `rules.json`, Studio and ingest must read the same file. In Compose
  and Kubernetes the simulator gets it as a read-only mount; if it is absent, Studio hides the expectation and says
  so.
- Tokens are copied from the command center until the two repositories can share a package. They can drift; the
  brief lists this as an open question.
- Any future change of the topic or payload goes through `@itp/telemetry-contract` as before; Studio does not
  define its own copy.

## Amendment 2026-10-19: UI direction from the design review

The [design note](../design/simulator/design-note.md) reviewed the first draft of the UI. Its outcome changes three
of the decisions above; the rest stands. The per-recommendation record is in the
[brief](../design/simulator/brief.md#what-revision-2-changed).

1. **Decision 6 is refined: Studio leads on token values.** The token _names_ still equal the command center's, but
   the _values_ (a darker canvas, an indigo accent at `#8B9DFF`, one red, Geist and JetBrains Mono) are Studio's own.
   Studio ships first and is the proposal for the command center's refresh after its V2; until then the two products
   differ in look when shown side by side. This was accepted deliberately.
2. **Decision 4 is extended: the UI stack.** React with Vite stays. The note's Next.js is not adopted: the app is
   static files served by the simulator and needs no server rendering, routing on a server or a second runtime.
   **Zustand** (already used by the command center) and **React Flow** are added. React Flow is a new dependency,
   chosen for pan, zoom, selection and edge rendering that would otherwise be written and made accessible by hand;
   SIM-06 records its licence and bundle cost. Tailwind is not adopted, since the tokens are CSS variables that
   follow the command center's names. The chart library is decided in SIM-06.
3. **Decision 2 gains a simulated-clock mode and an observation store.** Step and Reset need an engine whose time
   advances when told to (SIM-02). Ingest's `GET /api/alerts` carries no delivery timestamp, so the control server
   records when it first saw each state change and the UI labels those times as observed (SIM-03). Adding a
   timestamp to ingest is a possible later change and is not assumed.

A 3D digital-twin view was deferred here and has since been reopened: see [ADR-0012](0012-simulator-studio-digital-twin.md).

## Amendment, 2026-10-20: electric palette

Studio's look moved from "neon on data lines only" to an electric neon style across the product, and its palette to
electric tones (accent `#959BFF` instead of `#8B9DFF`; success, warning, danger, info and alert-high brighter, all at
least 4.6:1 on surface-2). Token names are unchanged, so the command center can still adopt the values by changing
`:root`. The rules that keep it legible, the tokens and the animation timings are in the
[design brief](../design/simulator/brief.md) (revision 12) and `docs/design/simulator/mockups/studio.css`. The decision
above, which keeps the engine, the control plane and the UI contract as they were, is not affected.

## Amendment, 2026-10-20: engine behaviour as built (SIM-02)

The engine ([engine.ts](../../apps/simulator/src/engine.ts)) is the module decision 1 describes. What it does, so that SIM-03 and
later tickets build on it and nobody has to infer it from the code:

- **Seams.** Time comes from a `Clock` and messages go to a `Publisher`, both passed in; the engine owns neither the wall clock
  nor the MQTT client. `main.ts` adapts the client; tests use a manual clock.
- **Simulated-clock mode** is the engine running on a `ManualClock`, chosen when it is built. `step()` moves the clock by one
  default publish interval and sends the tick that falls due. `ts` follows the clock, so stepping far ahead of real time makes
  ingest reject the messages as `future` (more than 5 minutes ahead, [telemetry contract](../telemetry-contract.md)); nothing
  guards against it.
- **Reset** clears anomalies and held values and restarts the anomaly clock at zero. It never touches `seq`, `ts` or device
  states, so ingest never reads a Reset as a device restart.
- **Devices.** Pause and stop both stop publishing and keep `seq`. A device that is started again publishes after one of its
  intervals. A device can have its own interval; the engine's applies otherwise.
- **Held value.** Per device and metric, published exactly with no noise, and it wins over an anomaly on the same metric.
- **Anomalies** can be added and removed while running; `startAt` is in seconds on the anomaly clock (since start or the last
  Reset). Shapes: `step` (the existing one), `ramp` and `spike`. `--anomaly` still takes five fields and always means a step.
  Anomalies passed at construction (the CLI) are not validated; `addAnomaly` checks the device, the metric, the numbers and the
  shape.
- **Failures.** The first tick's failure rejects `start()`, as the old loop's un-caught first tick did; a later failing tick is
  reported once as a `tick-error` event and the loop goes on. After a long stall the missed ticks are skipped, not sent.
- **Events and state.** `state` (every change an operator can make), `published` (a message the publisher accepted) and
  `tick-error`; `snapshot()` returns the whole state. These are what the control server (SIM-03) forwards. The 200-entry publish
  log and the observation store are SIM-03's.
- **One intended change to the command line.** An `--interval` that is not a positive number now stops with a `RangeError`;
  before, `--interval abc` made the loop publish every millisecond. Everything else about the flags, output and exit
  behaviour is as before.

## Amendment, 2026-10-20: control server as built (SIM-03)

The control plane of decision 2 is in `apps/simulator` ([control-server.ts](../../apps/simulator/src/control-server.ts) and the files
the [README](../../apps/simulator/README.md#control-server) lists); the README has the routes and the events. What was decided on
the way, so that SIM-04 onward does not have to infer it:

- **On by default, off with `--no-control`.** `pnpm --filter @itp/simulator start` runs the server; the Compose `demo` command needs
  no change to serve Studio later. `bench.ts` never starts it. The settings are `CONTROL_HOST` (`127.0.0.1`), `CONTROL_PORT` (`3200`),
  `INGEST_URL`, `OCC_CONSOLE_URL` and `CONTROL_ALLOW_NON_LOOPBACK`; a flag overrides the first three.
- **Loopback is enforced, and checked before anything is sent.** Only `localhost`, `127.0.0.0/8` and `::1` are accepted without
  `CONTROL_ALLOW_NON_LOOPBACK=true`; otherwise the process says so and exits 1 before it contacts the broker. The port is bound before
  the first publish, so an unusable port ends the process with nothing sent. The Compose `demo` profile will need a non-loopback bind
  _inside_ the container (SIM-04), with the host side of the published port limited to `127.0.0.1`.
- **No authentication, but no cross-site reach.** No CORS header is ever sent; commands must be `Content-Type: application/json`; the
  `Host` header must name this machine (against DNS rebinding). This is on the new surface only; the broker and ingest are as they were.
- **Ingest state is decided by `/api/ready` alone.** A `503` from it is an answer (which dependency is down); anything else that is not a
  usable reply is `unreachable` on the first failed poll. A failing `/api/alerts` or `/metrics` keeps the last data, marked stale.
  Polling is once a second with an 800 ms timeout, and a cycle never starts before the last one ended.
- **Observed times are honest about what they are.** The first read of `/api/alerts` is a baseline: alerts already in ingest are listed
  as `preexisting` with no observed times and no events. Delivery is tracked per alert and per phase (opened, cleared), because
  `deliveryStatus` describes only the latest outbox event. Times come from the poller's wall clock, never the engine's, which may be
  simulated. The store keeps 5,000 observations in memory and not the published messages.
- **The publish log is SIM-03's, republish is SIM-13's.** The server keeps the last 200 published messages and sends them in the first
  message of the stream; there is no resume, a reconnecting client gets a new snapshot.
- **Nothing a listener does can stop a publish.** The engine emits `published` from the promise of a publish that succeeded, so an
  exception in a listener would turn it into a failed tick. Every listener the server adds is wrapped, and tests cover a client that
  disappears and a store that throws.
- **Step is not reachable in a real process yet.** The engine's simulated-clock mode is chosen when it is built and `main.ts` builds the
  wall-clock engine, so `POST /api/step` answers `409` there. The ticket that first needs Step in a running process adds a startup flag.
- **Ingest metric names are copied, not shared.** The contract package does not export them; the list is `FORWARDED_METRICS` in
  [prometheus-text.ts](../../apps/simulator/src/prometheus-text.ts), noted beside the metric table in
  [operations.md](../operations.md#metrics). Nothing checks it against ingest.

## Amendment, 2026-10-20: Studio shell as built (SIM-04)

The package `apps/simulator-ui` and the shell around the pages are in place (header, navigation, command palette, the Overview's
connection card, the internal Foundations page); every other page opens a placeholder that names the ticket that builds it. What was
decided on the way, so that SIM-05 onward does not have to infer it:

- **The control server serves the build** ([static-files.ts](../../apps/simulator/src/static-files.ts)). `GET /` and any path that is not `/api` and not a file answer with `index.html`; files under
  `/assets/` carry a content hash and are cached for good. A strict `Content-Security-Policy` is sent on the static files. The directory
  is `STUDIO_DIR` (default `apps/simulator-ui/dist`, `/app/ui` in the image). A directory that is not built is not an error: the API
  works, `start` prints a hint, and no script (`bench`, `test`, `build` of the simulator) needs the UI built.
- **One origin, so no CORS.** In development Vite proxies `/api` (the event stream included) to the simulator; in the demo the simulator
  serves both. The control API still sends no CORS header.
- **`GET /api/state` reports the broker** (`broker: { url, port, connected }`, fed by the MQTT client) and the stream has a `broker`
  event. The header pills need it; the UI keeps no second source. `src/api/fixtures/state-view.json` is the shape the UI is written
  against, and a test in `apps/simulator` fails if the server's `StateView` and that fixture drift apart.
- **The Command Center pill is inferred, not probed.** Studio does not call the command center. Ingest reports `alertSink` (`none` or
  `ops-command-center`) on `/api/ready`, and an alert whose delivery failed says the sink is not taking alerts; the pill shows "not
  configured", "delivery failing" or nothing to add. While ingest does not answer, the last sink it reported is shown dimmed.
- **State management stays small.** One vanilla Zustand store per window, fed by the event stream; `snapshot` replaces the view, the
  slice events replace their slice, and a `state` event (an operator changed something) triggers one debounced `GET /api/state` instead
  of a second copy of the engine's rules in the browser. `published` only feeds a rate. React Router is used as plain `<Routes>`: nothing
  is fetched per route, because the stream is the data. No query library.
- **Foundations is for people who build Studio.** `/foundations` and its code exist in development and tests and are left out of a
  production build unless `VITE_STUDIO_FOUNDATIONS=true` is set at build time (a literal `define`, so the bundler drops the lazy import).
- **Compose lifts the loopback guard inside the container only.** The `demo` simulator listens on `0.0.0.0` with
  `CONTROL_ALLOW_NON_LOOPBACK=true`, and the host side of the port is `127.0.0.1:${STUDIO_HOST_PORT:-3200}`. This is the case the SIM-03
  amendment announced; the demo posture (no authentication) is unchanged.
- **Palette actions are listed, not run.** Pause, resume and the scenario runs appear in search with "Available from the Overview
  (SIM-09)" and do nothing until that ticket gives them a place to confirm.

## Amendment, 2026-10-20: rules and profiles for Studio (SIM-05a)

Fleet draws each rule's raise and clear lines and a range bar per metric, and shows the baseline, noise and daily swing of each
metric. The control API gave neither, so `GET /api/state` has two more parts. What was decided:

- **`rules`** is `{ available, reason, items }`. The simulator reads `rules.json` once at start ([rules-source.ts](../../apps/simulator/src/rules-source.ts);
  `--rules`, `RULES_FILE`, else the ingest's file) and validates it with the checks of ingest's `parseRules`, copied because that module is NestJS. A missing or
  invalid file does not stop the simulator; it is said once at start and in the state, and Studio hides what depends on it (the consequence above that said so).
  A test reads the repository's own `rules.json` through this code, which catches a change of the data that Studio could not read, not a change of the logic.
- **`profiles`** is the generator's own constants by device and metric ([signals.ts](../../apps/simulator/src/signals.ts)), read-only. Editing a profile would be an
  engine feature and is not part of this ticket.
- **The demo image copies `rules.json`** into `/app/registry/` next to `devices.json` and passes `--rules`, instead of the read-only mount that the consequence above
  describes. Both files come from the same commit as the ingest image built beside it, so they cannot drift; `--rules` and `RULES_FILE` still allow a mount. There is
  no simulator in the Kubernetes manifests.

## Amendment, 2026-10-20: Fleet as built (SIM-05)

The Fleet (cards up to 12 devices, a table above or on request, the inspector, the bulk bar) is in `apps/simulator-ui`
(`src/pages/fleet/`). What was decided on the way, so that SIM-06 onward does not have to infer it:

- **The stream's `published` messages are now kept, in the browser, for two minutes.** SIM-04 did not store them. The charts
  and sparklines need a history, so [history.ts](../../apps/simulator-ui/src/state/history.ts) keeps a bounded ring per device
  and metric (120 s from the newest reading, at most 600 points), fed by `published` and seeded by the snapshot's publish
  log, which replaces what was there (so a reconnect does not double it). It is outside React and outside the Zustand store,
  and tells a component about its key at most once a second: a message arrives about fifteen times a second and nothing
  renders per message. After a reload a chart holds only what the simulator remembered (the last 200 messages, about a
  minute at six devices) and says so ("collecting, 40 s of 2 min") instead of drawing a guess. A server-side history
  was considered and not built.
- **Charts are hand-written SVG** (`src/ui/charts/`: line chart, sparkline, range bar), drawn at the pixel width of their
  container so text stays 13 px, with the amber part drawn as the same path through a `clipPath`. No charting dependency;
  the library question of the brief stays open for the pages that need more.
- **No alert marker on the charts**, as on Topology: the raise and clear lines, the amber part and the state beside the
  name carry it.
- **A device's state is derived, not reported:** the engine says running, paused or stopped; Studio adds _anomaly_ (the
  newest value is beyond a rule's raise line; with the rules not available, an anomaly the engine is playing now) and
  _silent_ (running, but nothing heard for three intervals, at least five seconds). A device never heard from since the
  page opened is not called silent.
- **The address is the state of the page:** search, zone, class, state tab, sort, grouping, view, page, size and the open
  device are query parameters, validated with a fall back to the default. Opening the inspector adds a history entry (Back
  closes it); a filter replaces the entry.
- **Cards up to 12 devices, a table above; a table can always be asked for.** Filtering, sorting and paging run in the
  browser over the list the state already holds; server-side paging, which the brief asks for above 60 devices, waits for
  the catalogue (V2-T05), which is the first thing that can exercise it.
- **Commands answer with the whole state and the page uses the answer at once.** Bulk commands run one device after
  another, with progress, a "Stop here", the failures and their reasons, and a question first above ten devices. There is no
  bulk route.
- **The inspector and the hold dialog are modal:** the shell behind is inert (a counter in the store), Tab stays inside,
  Esc closes, focus goes back to what opened it. A value to hold outside the range of the telemetry contract is refused in
  the control; sending one on purpose is the Faults page's job. Not offered, because the engine has nothing behind them:
  jitter, QoS and acknowledgement time, resetting `seq`, editing a profile.
- **The running-scenario strip and the Follow menu are not built here;** they need the run state that SIM-08 adds.

## Amendment, 2026-10-20: Topology as built (SIM-06)

The Topology (the graph, its neon edges, the row under it and the dependency-down states) is in `apps/simulator-ui`
(`src/pages/topology/`, with its logic in `src/lib/topology*.ts`, `pipeline.ts`, `ingestRates.ts` and `downstreamHops.ts`).
What was decided on the way:

- **React Flow is adopted for the graph** (decision 2 of the amendment of 2026-10-19, now carried out). `@xyflow/react`
  12.12.0, licence **MIT**; it brings `@xyflow/system` (with the d3 modules it uses), `classcat` and its own, older
  Zustand 4 (a second copy of the library, next to Studio's Zustand 5). It is a **lazy chunk**: only a visit to `/topology`
  downloads it. Measured by Sếp with `pnpm --filter @itp/simulator-ui build` on 2026-10-20, before (at `63df914`, the
  model only) and after the whole ticket (the SIM-06c working tree, before its commit); the machine was not recorded, and
  Vite's sizes are as it prints them:

  | Chunk                                                   | Before                  | After (the whole ticket)                                  |
  | ------------------------------------------------------- | ----------------------- | --------------------------------------------------------- |
  | First load (`index` + the chunks `index.html` preloads) | 311.95 kB (101.08 gzip) | 316.24 kB (103.83 gzip)                                   |
  | `Topology-*.js` (new)                                   | —                       | 224.66 kB (72.44 gzip), with its CSS 29.19 kB (5.38 gzip) |

  Part way (the graph, before the row under it was built) the same chunk was 207.66 kB (67.30 gzip) with 24.25 kB of CSS,
  so the row, the banners and the checks account for about 17 kB of the final figure.
  The Topology chunk holds React Flow **and** the page's own code; the split between them was not measured. The Fleet
  visit went from 373.03 kB to 378.2 kB (the first load, `useFleetRows-*.js` and `Fleet-*.js`) because Rolldown moved shared
  modules into two shared chunks; a visit to `/topology` adds `useFleetRows-*.js` and `Topology-*.js`, about 249 kB (82 kB gzip) of script. Why not a
  hand-written graph: the graph is fixed (about 20 nodes, nothing is dragged or connected), so a hand-drawn SVG was
  possible; what React Flow gives and a hand-written one would have to build and make accessible is pan, zoom, fit, the
  minimap, node focus and selection by keyboard, and edge geometry under zoom. The cost above is what a later decision to
  replace it would be made against.

- **The chart-library question of the brief (open question 6) is closed: hand-written SVG stays.** The Fleet's line chart,
  sparkline and range bar draw the detail row as well; the live data is at most a few hundred points per series for two
  minutes. ECharts (even tree-shaken) and uPlot would add a dependency and a second drawing language for no feature
  Topology needs.
- **The graph is derived from the store, never the other way round.** `buildTopology` (a pure function) says which nodes
  and edges there are, where and in what state; `useTopologyModel` rebuilds it about once a second (the page's clock, the
  metrics) and `Stable` hands React Flow the **same object** for every node and edge whose content did not change, and every
  node and edge component is `memo`. That is how a state update re-renders only the nodes that changed; a test counts the
  renders per node (`TopologyGraph.test.tsx`). The layout is computed by hand (`topologyLayout.ts`): the shape is known, and a
  layout library would be a second new dependency. The pipeline never moves when a zone opens.
- **Scale follows the brief:** up to 12 devices every device is a node inside its zone; up to 60 a zone is one node (count,
  worst state, a chevron that opens it in place to the 6 worst devices and "+ n more"); above 60 a zone shows counts only,
  worst first, and a device is reached by the search or _Problems only_. A zone that is open for a reason of its own (the
  selection, a search, "All devices") cannot be closed by its chevron, and says so.
- **The address is the state:** `?q=`, `?group=`, `?problems=1` and the selection (`?device=`, `?node=` for a stage,
  `?zone=`, which the palette already linked to). Every change replaces the history entry: a selection is not modal.
- **Dots come from a small seam outside React** (`state/pulses.ts`): each `published` message of the stream tells a `PulseBus`
  which device published; an edge animates its dots by hand with `requestAnimationFrame` (at most 4 per edge, none under
  `prefers-reduced-motion`, none while the tab is hidden, none on an edge that is not lit). Past the broker there is no
  per-message signal, so a dot on a later edge means that something measurable advanced (the stored-readings counter
  between two reads of `/metrics`, an alert first seen, a delivery that became `delivered`; `downstreamHops.ts`). The
  glow is stroke layers and a CSS shadow, never an SVG filter, because a filter box clips under pan and zoom.
  The `published` messages are still not in the Zustand store.
- **Only what Studio can know is drawn.** Ingest's lag and rate are the difference of two reads of its counters; "n of for"
  on the Rules node is Studio's own count of the readings it saw; the command center is never read, so an incident id is all
  it shows. Not drawn because nothing measures them: a PUBACK time, a buffer size, "Open" for an incident. When ingest does
  not answer, the stages after it say "Unknown", dated and dimmed.
- **Left out on purpose:** the _Topology | Twin_ switch (SIM-18), the _Data flow | Alerts_ layer switch, "Show in twin" and
  "Open in lab", "Retry now" (ingest is asked again every second whatever is pressed), the scenario chip and the Cause row
  (SIM-08), zone names (the registry has codes only), labels on the edges.
- **A silent device is grey on Topology, as the frames and the brief draw it, and red in the Fleet** (SIM-05 maps it to a
  down node). The two are recorded here and not reconciled; changing the Fleet is a one-line change of `deviceStatus` and
  its tests.
- **The broker being disconnected is drawn without a frame:** the Broker node is down, the links of the devices are dark
  wires, a banner says so and the Checks show it in red.
- **The incident link goes to the console, not to an incident.** Which page of the command center shows an incident is
  its own route and Studio does not know it; with `OCC_CONSOLE_URL` set (an http or https URL; any other scheme is dropped)
  the alert card links to the console and names the incident by its id. SIM-07 settles the link.

## Amendment, 2026-10-20: Alerts as built (SIM-07)

The Alerts (the list, the detail and the delivery trail) is in `apps/simulator-ui` (`src/pages/alerts/`, with its logic in
`src/lib/alert*.ts` and `cursorPaging.ts`), and, unlike the Topology, it needed the simulator: the ticket was built in two
halves. What was decided on the way:

- **A route in the simulator, because the browser cannot reach ingest.** The Content-Security-Policy is
  `default-src 'self'; connect-src 'self'` and no CORS header is sent, both on purpose; Studio only talks to the simulator that
  serves it, and the alerts it already had were the newest 100 that the poller reads once a second. `GET /api/alerts?status=&limit=&before=`
  (`apps/simulator/src/control-routes.ts`) asks ingest for one page and answers with it: ingest's array and its `X-Next-Cursor`
  header, copied unchanged. The alternatives were to build a cursor from the 100 Studio holds (against the acceptance criterion
  that a cursor is never built) and to widen the policy (against the decisions above). `IngestPoller.alertsPage` reads the page
  with its own timeout (3 s; the poll's 800 ms is for a request a second) and changes no feed. Ingest's `400` is relayed as `400`
  and anything else that is not a page as `502`; `StateView`, the poll and the stream are untouched. The query is checked before
  ingest is asked; `before` is passed URL-encoded and otherwise unread.
- **Each alert carries what only Studio knows.** The elements are ingest's alert plus `preexisting` and `observed` (as in the
  state view; empty for an alert Studio never tracked) and `cause`. The server adds them so that older pages have their observed
  times when Studio saw them, and so that the rule for a cause is one tested place.
- **A cause is claimed only on evidence.** `POST /api/scenarios/:name/run` now records the anomalies it added (id, device, metric,
  `startAt` with the offset, duration) in its `scenario-run` observation, because the engine forgets them on a reset. An alert has
  `cause: { scenario, startedAt }` when such a run added an anomaly on its device and metric and the alert opened from the
  anomaly's start until 30 s after its end (`CAUSE_SLACK_S`, `alert-cause.ts`); the newest run wins. It is a match by device,
  metric and time, not a proof: a fault added by hand on the same metric inside a run's window would be taken for the run's. The CLI's
  `--scenario` leaves no run, so its alerts have no cause; an engine on the simulated clock never claims one, since its time is not
  wall time. The 30 s is a judgement, not a measurement.
- **The cursor stays in memory.** Paging is one way (older); Studio keeps the cursors it was given in a stack and _Newer_ pops it.
  The address holds the status, severity, size and open alert, not the cursor, so a reload opens the newest alerts and a stale
  cursor can never be shared. There is no "Page n" and no total; the line says "Showing 5 alerts · newest first".
- **The severity filter hides rows; it does not search.** Ingest has no severity parameter, so the filter applies to the loaded page and
  the list says how many rows it hides. No further pages are fetched to fill a page.
- **A page is a snapshot; the store's fresher facts are laid over it only when ahead.** A delivery or a clear is heard a second after it
  happens, and a page fetched since may be fresher than the store, so `overlayLive` takes the store's copy of a row only when it saw
  more happen (observed times are only ever filled in). The newest page asks again when the store hears of a new alert or a status
  or delivery change; older pages are never refetched by the page.
- **Times say whose clock they are.** `openedAt` and `clearedAt` are ingest's; the delivery and the incident are when Studio first
  saw them, to within its 1 s poll; the first breaching reading is a reading Studio recorded (it keeps two minutes, so for an older
  alert the step is left out, with a note). `deliveryStatus` is the state of the _latest_ outbox event: for a cleared alert it is the
  clearing's, and the opening's delivery is known only from what Studio saw or from the incident id.
- **The incident link goes to the console root,** as in SIM-06. Which page of the command center shows an incident is its own route
  and was not checked here; a deep link needs that route. The id is shown beside the link with a copy button.
- **Small shared pieces moved or were added:** `DeliveryChip` and `severityOf` left the Topology's `AlertsCard`; `SelectField`
  and `CursorPager` are new in `ui/`; `CopyButton` can carry visible words. No dependency was added.

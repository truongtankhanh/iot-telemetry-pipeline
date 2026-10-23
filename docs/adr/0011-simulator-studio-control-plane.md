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
  Reset). Shapes: `step` (the existing one), `ramp` and `spike`. `--anomaly` took five fields and always meant a step (SIM-11 added an optional sixth, the shape; see the amendment of 2026-10-22).
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

## Amendment, 2026-10-21: Scenarios as built (SIM-08, simulator half)

- **A scenario is one plain JSON document wherever it comes from** (`{ name, description?, anomalies[] }`, the engine's `Anomaly` with
  times in seconds from the scenario start). The built-ins are typed objects in `scenarios.ts`, custom ones are `*.json` files in
  `SCENARIOS_DIR` read once at start, imports are kept in memory for the session. One validator (`scenario-document.ts`) serves all three:
  it refuses an unknown field, a device the registry in use lacks, a value outside the range of the telemetry contract, and two
  anomalies that play at once on one device and metric, with the field and the range in the reason. A built-in that does not fit a
  registry is rejected like a file, not played.
- **Custom scenarios are read-only files; an import writes nothing.** The order document said "read-only here" and left the storage to
  SIM-11 (brief, open question 3); an import validated like a file and kept for the session meets the acceptance criterion without a
  first write route on an unauthenticated server. SIM-11 can move the storage without changing the document.
- **Runs are derived, not stored.** `ScenarioRuns` keeps the ids of the anomalies a run added and the anomaly-clock time at which it ends;
  a run is active while the clock is before that end and one of its anomalies is still in the engine, so time, a stop, a reset and a
  `DELETE` all end it without telling anyone. `StateView.runs` lists the active ones (additive; the fixture and the UI types follow).
  `scenario-run` keeps its fields and gains `runId`, `startedDevices`, `replaced`; `scenario-stop` is new. The cause of an alert (SIM-07)
  is unchanged.
- **A scenario never plays over another anomaly.** The engine plays the first anomaly that matches a device and metric, so a second one
  on the same signal was silently ignored; stacking was a defect, not a feature. A run is now refused with `409` and the conflicts
  (device, anomaly, run) unless it is asked to replace, and the check looks at every anomaly that is active or still to come, whoever
  added it: the Compose `demo` boots with `--scenario server-room-overheat`, which no run owns. Replacing stops the whole conflicting run
  and removes a loose anomaly alone. Adds happen first and roll back on an engine refusal, so a failed replace changes nothing.
- **A run starts the devices it needs,** stopped or paused, inside the same all-or-nothing step, and a stop leaves them running. The library
  read lists them beforehand (`needsStart`).
- **Expected alerts are a best case, in seconds from the scenario start, to within one publish interval.** They are worked out on the tick
  grid with the noise-free signal and ingest's rule semantics (`for` consecutive strict breaches to open; one reading back past the clear
  line to clear; `opened_at` is the reading's own time). A device already running publishes on the engine's grid, which is not aligned
  with the click, so the real alert can be up to one interval later; a device the run starts is aligned with it (its first tick is one
  interval after the click). The clear is `uncertain` when the baseline is within the noise of the clear line: with `indoor-co2` clearing
  at 1000 ppm and the CO₂ baseline peaking at exactly 1000 at 13:00 campus time, a clear can take several ticks, or not come until the
  hall empties; `power-over-contract` is close to the same. Left alone here (calibration of `rules.json` and the profiles is not this
  ticket). One alert is expected per anomaly and rule; an alert already open when the run starts is not known.
- **No guess without the rules.** If `rules.json` could not be read, `expected` is `{ available: false, reason }`. A walk longer than
  20,000 ticks (a very short interval on a long scenario) is refused the same way.
- **Nothing in ingest, the contract or the metrics changed;** no dependency was added. The folder is outside `src/`, so the image has no
  custom scenarios unless a volume is mounted on `SCENARIOS_DIR`.

## Amendment, 2026-10-21: Scenarios as built (SIM-08, Studio half)

- **The page pages the whole library.** `GET /api/scenarios` sends every scenario with what its card needs; the browser searches (every word in the
  name, a device of its anomalies, or the id or title of a rule it should raise), counts the tabs over the search, sorts (recently run, name,
  longest first) and cuts the page, 6, 12 or 24 cards, with the Fleet's pager. The address holds the search, the tab, the sort, the page, the size
  and `?scenario=` (the palette's link), so a reload opens the same page. `?scenario=` is a pointer, not a filter: it marks the card and shows
  its page, says so when a tab or the search hides it or when there is no such scenario, and any other change of the address drops it.
- **The library is read again when something it depends on changes,** not on a timer: the signature is the ids of the runs and each device's state
  and interval (`needsStart`, `running` and the expected times depend on them), plus after each of the page's own commands (an import adds a scenario
  without changing the signature). The last good library stays on show through a failed or running read; an overtaken read is aborted and never shown.
- **A card says what the simulator worked out and nothing else.** The sentence, the flags and the curve come from `expected`; the browser never
  computes an alert time. Times are plain seconds from the scenario start and read "about"; a clear that may come later reads "or later", one that was
  not found "clear time not known" with a note; an anomaly that no rule watches, or that never crosses, is told; with no rules the card gives the reason and
  draws no chart.
- **The chart is a figure at its true pixel width** (text 13 px, colours from tokens): the value against the rule's raise and clear lines with the alert
  and the clear as flags for a scenario on one device and metric, and one lane for each device (at most four, then a line of text) for any other. A label
  that would run into another or out of the picture is left off and kept in the tooltip; the sentence of the `role="img"` carries every number. The
  playhead is a still line with a pill, drawn only while the scenario plays; its time is the anomaly clock minus the run's offset, advanced by the page's
  clock on the wall clock and not on the simulated clock (which moves only on a step).
- **Replacing is asked about after the simulator refuses,** not predicted: Run is sent without `replace`; a `409` with conflicts becomes a dialog that
  names the runs and the loose anomalies in the way, and Replace sends the run again with `replace`. The rule stays in one place (the simulator knows about
  the command line's scenario too). The dialog is modal like the hold dialog; its focus goes back to the Run button even though that button was disabled
  while the request was on its way.
- **Import is a file picker.** A file that is not JSON, or over 16 KiB, is refused before it is sent; anything else is the simulator's to refuse and its
  reason is shown as it is ("anomalies[0].value 900 is outside the range of temperature_c (-40 to 85 °C)"). A success points the address at the new card.
- **Shared pieces:** `Pager` has an optional note after its range and an optional polite announcement (the Fleet uses neither); `LabSwitcher` is the
  switch between the Lab's pages, built from the routes; `ApiError` keeps the body of a refusal and `conflictsOf` reads a `409`'s conflicts.
  `fixtures/scenarios.json` is a `GET /api/scenarios` body: the key lists of `client.test.ts` and of `apps/simulator/src/control-routes.test.ts`
  compare against it.
- **Not built here:** the Fleet's running-scenario strip and the **Follow** menu (no page to take the person to yet), and **Edit**, **Duplicate** and
  **New scenario** (the editor, SIM-11). The palette's `run <name>` actions stay listed and disabled until SIM-09. No dependency was added.

## Amendment, 2026-10-21: the simulated clock in a running process (SIM-09, simulator half)

The SIM-03 clause "Step is not reachable in a real process yet" is met. `start` runs the engine on a `ManualClock` when it is given
`--simulated-clock` or `SIMULATED_CLOCK=true` (the exact value, as `CONTROL_ALLOW_NON_LOOPBACK`); the option only turns it on, so going back
to the wall clock is unsetting the variable. The mechanism was already there (SIM-02): `Engine` takes `clock`, `POST /api/step` and
`POST /api/reset` and `config.simulated` exist, and no route, no state key and no fixture changed. The SIM-03 clause stays as written; this
section supersedes it.

- **The clock starts at the wall time of the process start** (`new ManualClock(Date.now())`), so the first `ts` is inside ingest's window.
  The anomaly clock, a scenario's time, the daily curve and every `ts` follow it. What records when Studio _saw_ something (the observation
  times, a run's `startedAt`, the ingest poller) stays on the wall clock, as designed in SIM-03.
- **Nothing publishes between steps.** One tick is sent at start; after that the message rate is 0 by design. The banner says so.
- **It is opt-in and absent from Compose and the image,** so a demo that is left running still publishes by itself; `bench` never reads it.
- **`--no-control` with the mode is refused at start,** before the process connects or publishes: the control server is the only way to
  step, so the process would publish once and then never again. The setting is resolved by `resolveSimulatedClock` in
  [control-config.ts](../../apps/simulator/src/control-config.ts) and is not a field of `ControlConfig`, which belongs to the control
  server and does not exist under `--no-control`.
- **Stepping ahead of real time is not guarded.** Ingest rejects a `ts` more than 5 minutes ahead of its own clock (`future`), and
  `telemetry_rejections_total` shows it; a guard in the simulator would be a second copy of ingest's rule.
- **No engine pause was added.** Pause in Studio pauses the devices through the existing routes, and the scenario's clock keeps counting
  on the wall clock; a pausable clock is a different change to `engine.ts` and `clock.ts`.
- **For the Studio half:** a stepped process makes `deviceStatus`'s _silent_ meaningless (it compares the browser's wall clock with the
  message `ts`, which stands still between steps), so the Overview must not call a device silent on a simulated engine.

## Amendment, 2026-10-21: Overview as built (SIM-09, Studio half)

The Overview ([frame 11](../design/simulator/mockups/11-overview.dc.html)) is the page Studio opens on. It reads only what Studio already
had, plus the simulator's observation log, and adds no dependency and no route to the simulator (the simulated-clock flag of the
simulator half is the amendment above).

- **Every figure has the source of its detail page.** The six key figures are computed in `lib/overviewKpis.ts`: devices online is the
  engine's `running` devices over the registered ones (the Fleet's "Active devices"; the brief's definition of availability), active alerts
  are the open ones of the store's alert feed by severity (the Alerts page's and the Topology's feed: the newest 100 the poller keeps, and
  the card says so when the feed is full), the rate is the stream's, the lag is the Topology's `IngestRates` written with the same digits as
  its Ingest stage (a test pins the two), delivery counts the feed's `deliveryStatus`, and "not reporting" is the Fleet's paused, stopped and
  silent. A source that does not answer makes its figure **"unknown" with the reason, never zero**. "12 readings buffered", the Broker's
  "4 ms" and the command center's "incident open" of the frame are not measured by Studio and are not drawn (open question 15 of the brief).
- **The observation log is in the browser, outside React.** `state/observationLog.ts` holds the last 5,000 events, deduplicated by `id`,
  notified once a second like the history. A snapshot of the stream carries `observationCursor` (the id of the newest event): when the log is
  behind it, `stream.ts` reads `GET /api/observations` newest first, 500 at a time, to the end (at most ten requests, one read at a time, a
  newer snapshot cancels the one going on) and adds the result; events that arrived live meanwhile are kept; a cursor **below** what the log
  holds means the simulator started again (its ids begin at 1), so the log is cleared first; a failed read changes nothing and the next
  snapshot tries again. The stream's `observation` event feeds it between reads. This gives numbered pages, a count, a density strip and an
  export without a second API, which a cursor-only pager (as the Alerts' has) cannot.
- **The timeline shows what was observed.** Sources: Fleet, Scenario, Alert, Outbox, Command Center, Ingest (`dependency`), Engine
  (`tick-error`, anomalies, reset). The frame's "Rule raised" and "Anomaly started" rows are **not observations** (the rule fires inside
  ingest; an anomaly's start is a time inside a run), so they are not rows: an alert row names its rule, and a run's row says what it started.
  The filter is `key:value` terms (`source`, `device`, `rule`, `alert`, `scenario`) and words, every one of which must match; an unknown key is
  searched as text and said so. Page, size, range (`5m`, `30m`, `1h`, `3h`, `12h`, custom with ISO UTC bounds), filter and source are in the
  address, beside the controls' `scenario` and the graph's `gq`, `group` and `problems`; Local or UTC is a per-viewer preference. The strip's
  handles can narrow the range, not widen it, and write it when released (pointer) or on key-up (arrow keys, Home and End). Export is a CSV of
  every event that passes the filter, with times in UTC, made in the browser by an object URL and a link with a `download` name; a download is
  a navigation, so `connect-src 'self'` does not apply, which is checked by hand.
- **Pause pauses the devices, and the scenario keeps counting.** The engine has no pause of its own (a pausable clock is a different change
  to `engine.ts` and `clock.ts`, not made). Pause pauses every running device through the per-device routes and Resume starts every paused
  one (no memory: a reload loses nothing, and a device paused by hand is resumed too, which the label says); both go through the Fleet's bulk
  run and ask first above ten devices. With the simulated clock there is nothing to pause, so Pause is absent; **Step** is drawn only there
  (the brief's "absent, not disabled"); **Reset** works on both clocks.
- **"Silent" is meaningless on a stepped engine,** because the messages' `ts` follows the simulated clock, which stands still between steps
  while the browser's does not. `deviceStatus` never calls a device silent when `engine.simulated`, so the Fleet, the Topology and the
  Overview agree.
- **The compact topology is the Topology's own model** (`useTopologyModel`, the same nodes, edges and tiers) in a shorter canvas
  (`TopologyGraph` gained `compact`: no minimap), without the detail row, the zoom bar or the Twin switch. It is a `React.lazy` card, so the
  figures, the feed and the controls paint before React Flow arrives. **Open in Topology** carries the grouping, the filter and the chosen node.
- **The palette runs nothing.** `run <name>` opens `/?scenario=<name>`, and `pause`, `step` and `reset` open `/?focus=<control>`; the Overview
  puts focus on that control once and takes the parameter out of the address. The "Available from the Overview (SIM-09)" note of the
  Shell amendment is now "Opens the Overview".
- **Shared pieces:** `Pager` has a `compact` variant and a `label` (the top pager of a table; the Fleet's and the Scenarios' pagers pass
  neither); `uiIcons.step`, `.download`, `.calendar`, `.filter` and `eventGlyphs`; `stepEngine`, `resetEngine` and `getObservations` in
  the client, with `fixtures/observations.json` checked from both sides (`apps/simulator/src/control-routes.test.ts`).

## Amendment, 2026-10-21: the expected-impact preview and the 100-device registry (SIM-10, simulator half)

The Lab shows what the rules should do with a fault before it is injected. That is the computation behind a scenario card's `expected`
(`expectedAlerts`), asked of anomalies that are in no scenario. The library cannot hold a draft per keystroke (a taken name is refused,
customs are capped, nothing is removed), and a second implementation in the browser could disagree with the cards, so the simulator answers.

- **`POST /api/expectations`**, body `{ anomalies }`, answer `{ expected, needsStart, intervalMs }`: the library item's own `expected` and
  `needsStart`, built by one helper (`expectationFor` in [control-routes.ts](../../apps/simulator/src/control-routes.ts)) that
  `GET /api/scenarios` uses too, so the two cannot drift; a test pins that the preview of a scenario's anomalies equals the library's
  `expected`. It is a `POST` because the body is a list; it is read-only (no anomaly, no library entry, no observation, no state change), and
  the README says so. Times are seconds from now, in the request and in the answer.
- **What it does not read.** The request is the only signal on its lanes, as a scenario's is; the anomalies the engine already plays are the
  caller's to check (`GET /api/anomalies`), because the engine plays the first match and does not add two values. A device that is not running
  is in `needsStart`, as for a run, and an injection does not start it (`POST /api/anomalies` never did).
- **Validation is a scenario file's, with its own cap.** `parseAnomalies` in
  [scenario-document.ts](../../apps/simulator/src/scenario-document.ts) holds the checks (device, metric, the contract's range, `startAt`,
  `duration` up to `MAX_DURATION_S`, shape, no unknown field, no overlap on one device and metric) and takes the cap as a parameter:
  a scenario file keeps 50, the preview takes 100 (a fault on every device of a registry that size; the 16 KiB body already limits it for
  long ids). `parseScenarioDocument` calls it, so no message or limit of a scenario file changed.
- **A total budget on the walk.** The walk is synchronous on the thread that also publishes. `expectedAlerts` has always refused a single
  signal that needs more than `MAX_WALK_TICKS` (20,000) readings; with the optional `maxTotalTicks` it refuses the sum over the signals, and
  only the preview sets it, so no scenario's `expected` changes. Over the budget the answer is `{ available: false, reason }` (a `200`), the
  shape the cards already handle, not a `400`: the request was valid, the guess is what is refused.
- **Observed, not changed:** `POST /api/anomalies` applies neither the contract's range nor `MAX_DURATION_S`, which a scenario file does. The
  preview is the stricter of the two, so a fault it accepts is always one the injection route accepts.
- **The 100-device registry** is a directory, [fixtures/devices-100/](../../apps/simulator/fixtures/devices-100/), with a `devices.json` and a
  copy of ingest's `rules.json`, because ingest rejects a device that is not in its own `devices.json` (`unknown_device`) and reads both files
  from `CONFIG_DIR`: a registry the simulator alone knew would open alerts for six devices out of a hundred. It sits outside
  `apps/ingest/config/` on purpose (CI, the parity tests and the images read that directory). It is generated by
  [scripts/gen-registry-100.mjs](../../scripts/gen-registry-100.mjs), committed, and checked against the script and against ingest's
  `rules.json` in CI (`scripts/gen-registry-100.test.mjs`, wired into `ci.yml` and `ci-local.sh`) and against the simulator's and ingest's
  rules for a registry (`src/registry-100.test.ts`). It keeps the six devices of the real registry so the built-in scenarios run; the 22
  `server_room` devices in three zones are the only kind with a temperature rule, so a breach on 12 devices in 3 zones raises 12 alerts with
  the real rules (frame 19's numbers: opening 24 to 46 s, clearing 80 to 102 s).
- **Zone codes.** The five of the real registry are the command center's. The other seven `BLD-` codes are the twelve buildings drawn in
  frame 14 of the design and are not checked against the command center; `SIM-Z01` to `SIM-Z08` are invented. The check runs without the
  command center, which would reject the codes it does not know.
- **Running ingest on it changes the database.** Ingest upserts every device into `device` at boot and keeps the rows, so a check against the
  development database leaves 94 devices behind. [development.md](../development.md#the-100-device-registry) gives a separate database for the
  check as commands to run by hand; nothing in the code creates or drops one.
- **For the Studio half:** types and `getExpected` against `apps/simulator-ui/src/api/fixtures/expectations.json` (a body of the route, with
  the key check in `control-routes.test.ts`); debounce the preview; say that an injection does not start a device and that the times are a
  best case ("about"); check the engine's anomalies for an overlap before injecting.

## Amendment, 2026-10-21: Lab as built (SIM-10, Studio half)

The Simulation lab ([frame 12](../design/simulator/mockups/12-simulation-lab.dc.html) and [frame 19](../design/simulator/mockups/19-simulation-lab-100.dc.html))
adds no dependency and no route to the simulator: it uses `POST` and `DELETE /api/anomalies`, `GET /api/state` and the preview route of the amendment above.

- **Add to timeline and Inject are two actions.** _Add to timeline_ keeps the faults in a draft held by the page (decision D4: a draft is not
  state of the simulator, so leaving the page drops it); _Inject_ sends them. A fault on several devices is one request per device, staggered
  by the form's offset. A request that is refused stops the rest and the page offers to remove the ones already accepted. The ids the
  simulator answers with are kept, so a fault can be removed; faults the page did not send (a scenario's, a run's) are listed as loose
  anomalies from the engine's own list and removed the same way.
- **The start is absolute (D1).** Before injecting, the page reads `GET /api/state` again and sets `startAt = engine.elapsedS + offset`, so a
  fault does not drift while the person reads the form. The preview asks with the same numbers (`startAt` as seconds from now), which is why
  the strip and the dock agree with what the engine then plays.
- **Overlap is refused in the page (D2).** The engine allows two faults on one metric of one device only when their windows do not meet;
  the page names the fault in the way ("d001 already has a fault on temperature_c from 20 s to 80 s from now") instead of leaving it to a
  refusal.
- **Eight tiles, one selectable.** Only Breach has an engine behind it; the other fault tiles read "Comes with SIM-12" and cannot be chosen. The
  stop condition is Timed or Manual (a manual stop is a long duration the person removes); "Alert clears" is shown disabled until the Lab can
  observe it.
- **The trace names the stages Studio can observe**: it has no "Broker ack" stage (the consumer's acknowledgement is not measured; ADR-0002).
  Rule evaluation is the Topology's (`RuleEvaluationFor`).
- **Zone codes, not names.** The simulator knows `zoneCode`; the catalogue that names a zone is the command center's and the Lab does not read
  it. There are no catalogue assets and no Topology | Twin switch (the twin is SIM-18).
- **The address carries the view**: `scope`, `target`, `zone`, `tab`, `page`, `log` and `logPage`, so a view can be shared. The form's values
  and the draft are not in the address.
- **The workspace is bounded to the viewport** (`calc(100vh - var(--header-h) - 52px)`, at least 640 px): each zone scrolls inside itself,
  so a long zone list or log never moves the canvas or the dock. Above 60 devices the canvas shows the zone list and the pipeline in a box of
  a fixed height and the chosen zone's devices in a table under them (10 a page).
- **Run and Stop are in the bar (D3)**, through the Overview's `useSimulationControls` and its replace dialog; the Lab starts no second
  mechanism for the engine's run.
- **Not checked by the tests** (jsdom computes no layout): the zones at 1920 px, the wall scale (`zoom`) with the viewport height, and the canvas
  filling its zone. They are a hand check, with the ticket's run against an ingest on `apps/simulator/fixtures/devices-100`.

## Amendment, 2026-10-22: custom scenarios saved as files (SIM-11, simulator half)

Brief, open question 3 asked where custom scenarios live; SIM-08 left them read-only (files read at start, imports in memory) and said SIM-11 could
move the storage without changing the document. The timeline editor needs a save that survives a reload and a restart.

- **Decision: files in `SCENARIOS_DIR`, written by the control API.** `PUT /api/scenarios/:name` creates or replaces `<name>.json` and
  `DELETE /api/scenarios/:name` removes it, through the validator that guards import and the folder (`scenario-document.ts`), so the contract ranges
  are checked before a scenario can be saved, not only before it runs. The document is unchanged; export is the file (or the card's data) and import
  stays. Alternatives considered: **browser storage** (no simulator change, but invisible to git, to the CLI and to another browser, and the library
  is empty after every simulator restart, so the page would re-import on load and race with taken names); **both** (write when the folder is
  writable, else keep in memory: two states to explain, and a save that lasts "until restart" is the surprise the folder exists to avoid). The
  mockups and the brief assume files. The constraint that forced the shape of the routes: a scenario is found and run by name, so a name is also a
  file name, and the existing name pattern (lower-case letters, digits, hyphens; no dot or slash) makes that safe.
- **Rules.** Only custom scenarios can be saved over or removed; a built-in answers `409` ("save a copy under another name"). A scenario that is
  running answers `409` on save and on delete, because runs are keyed by name and a stop of a scenario that is gone would be a `404`. A rename is
  not a route: save under the new name, then delete the old one. The 200-scenario cap counts new names. A save of an imported scenario writes it
  to a file. A library entry now remembers its file (`LibraryEntry.file`), so a scenario read from `foo.json` that holds the name `bar` is saved
  back to `foo.json`; otherwise the next start would find two files with one name and reject one.
- **The write path** (`scenario-store.ts`) is the only code that writes a scenario file. It checks the serialized size against the 16 KiB limit
  before touching the disk (a larger file is rejected at start, so a save that succeeded would make the scenario vanish at the next restart),
  writes a temporary file and renames it, refuses a new file whose name exists on disk but was not loaded (a rejected file is somebody's data;
  `409`), and refuses any name that is not a bare `*.json`. The library changes only after the write succeeded. A folder that cannot be written
  answers `500` with the reason (`EROFS`, `EACCES`…): the request is valid, the environment is not.
- **Security posture.** This is the first command of the control API that changes the disk (imports and runs only touch memory and the engine). The
  API still has no authentication; it listens on loopback, sends no CORS header, wants `Content-Type: application/json` and checks `Host`
  ([operations](../operations.md#security-posture)). What a caller can do is bounded: create, replace and delete `<valid-name>.json` files of at most
  16 KiB, at most 200, in one folder. Nothing was hardened here, as the V1 scope says; the row of the table says what the API can now write.
- **`--anomaly` gains an optional sixth field, the shape** (`device:metric:value:startAt:duration[:shape]`). Five fields mean what they always meant (a
  step). With it every scenario document, including a `ramp` or a `spike`, has a command-line form, which closes the gap that the ticket allowed to be
  "written down" instead. A sixth field that is not a shape, or a seventh field, is refused (a sixth used to be ignored).
- **Not decided here, left as they were:** the folder is read once at start (a hand edit is seen after a restart); no observation is recorded for a
  save or a delete (they are not events of the system under test); no route validates without saving (`POST /api/expectations` already refuses a bad
  list of anomalies with the field named, and the save validates the whole document); the Compose and Kubernetes volume for the folder is not wired
  (the README says to mount one).

## Amendment, 2026-10-23: Timeline editor as built (SIM-11, Studio half)

The timeline editor ([frame 05](../design/simulator/mockups/05-timeline-editor.dc.html)) at `/lab/timeline` builds, saves and runs a custom scenario.
It adds no dependency and no route to the simulator: it uses `PUT` and `DELETE /api/scenarios/:name` and `POST /api/expectations` (the
amendment of 2026-10-22 and the one before it), and the shared `GET /api/scenarios` read.

- **The working copy lives outside React, for the session** (`state/editorDrafts.ts`, provided by `StudioProvider`). The app is on the plain
  router (`<Routes>`), where `useBlocker` is not available (it needs a data router), so navigation inside the app cannot be held back by an "unsaved
  changes" prompt. Alternatives considered: page state only (the Lab's draft is that, and is lost on any navigation: right for a form, wrong for work that
  took ten minutes); moving the whole app to a data router (a cross-cutting change for one page). A copy is stored under a key for a saved scenario, for a
  duplicate and for the new scenario, on its first edit; leaving the page and coming back finds it, Discard drops it, a reload loses it and `beforeunload`
  asks while any copy holds work.
- **The model is pure** (`lib/timelineEditor.ts`, `timelineValidation.ts`, `timelineGeometry.ts`, `editorAlerts.ts`, `timelineDefaults.ts`,
  `thresholdPreview.ts`, `timelineExport.ts`), and the page's hooks only read and write it. The ranges come from the telemetry contract through
  `rangeOf` and the name pattern is the simulator's; the simulator stays the authority and its refusal is shown in its own words.
- **Collisions.** Two anomalies may not play at once on one device and metric (the simulator refuses a document with two). A drag or a resize stops at the
  neighbour's edge and says so; a typed number that would overlap is not applied and the reason is next to the field; a number out of the contract's range is
  kept and marked, because it may be half typed, and the scenario cannot be saved until it is fixed.
- **Run now saves first** when the scenario is new or changed, then runs it (the simulator half decided that a run plays a library scenario). A scenario that
  is running cannot be saved over or deleted (`409`), so Save and Delete are off and Run becomes Stop. A run that would play over something asks, with the
  Scenarios page's dialog.
- **The drawing is shared with the Lab's dock** (`pages/lab/TimelinePicture.tsx`, extracted from `TimelineDock`; `buildDock` gained optional inputs that are off
  by default, so the dock is unchanged and its tests are the check). The editor adds the selection, grips, keyboard and pointer editing, zones that open into
  their devices above 12 anomalies, the neon value line with the amber part inside a fault, a spark on the selected lane (inside the animation budget, never
  under `prefers-reduced-motion`) and one row for each expected alert.
- **Windows.** 120, 180 and 300 s are the part of the scenario that is shown, not a limit of the document. The window widens by itself for a later start or a
  longer duration typed in; it does not widen during a drag, which would rescale the picture under the pointer.
- **Keyboard.** A block is a button with one tab stop among them; the arrows move it by the snap step (5 s, or 1 s with the switch off), Shift moves its end,
  Shift and Alt its start, Up and Down go to the previous and the next block, Delete removes it. A plain `A` adds an anomaly. The inspector reaches everything the
  pointer does.
- **Managing scenarios** on the Scenarios page: Edit (custom), Duplicate (any, built-ins included, opens a copy), Export JSON (made in the browser, the same bytes
  the simulator writes), Delete (custom, not running, after asking) and the dashed New scenario card. The Lab's "Open timeline editor" hands the page's own timeline
  over as a new scenario that is not saved yet, replacing a new scenario that was being edited.
- **Not built, left as they were:** a drag on an empty lane to size a new block (a lane exists only where an anomaly does; a double-click, the button and `A` add);
  a tinted hysteresis band and start/end marks on the preview (the card chart shows both lines and the amber part; the start and the end are in a line of
  text); undo and redo; selecting several blocks; touch-sized grips; a view of the scenario as `--anomaly` flags (the simulator documents the flag).
- **What jsdom cannot check** (a hand check): the look at 1920 px and the wall scale, the neon filter and the spark, the feel of the drag with the snap, reduced
  motion, the page-leaving prompt, and the whole flow against a real simulator (build, save, reload, run, open the file in `apps/simulator/scenarios/`, run the same
  anomalies with `--anomaly`).

## Amendment, 2026-10-22: fault injection (SIM-12, simulator half)

The Faults page (frame 07) asks the engine to make the transport misbehave and to show the pipeline counting it. This was always listed as an
engine feature, not a UI one (decision 1, and the consequences above), and `apps/simulator/src/faults.ts`, `engine.ts`, `mqtt-link.ts` and
`fault-effect.ts` build it.

- **Decision: the fault layer is in the engine, at the publish step.** The `seq` is used before anything can happen to the message, so a drop
  leaves a gap by construction; `published` is emitted only for a message the publisher accepted, and a new `dropped` event says what was built
  and not sent; delays run on the injected `Clock`, so a stepped engine releases them on the step. The alternative, a `Publisher` decorator in
  `main.ts`, would have left the engine untouched, but a drop would then resolve as a success and the engine would emit `published` for a
  message that never left, which the publish log and the Message inspector (SIM-13) would show as fact; the simulated clock and `snapshot()`
  would need separate plumbing as well. With no fault on, a run is byte-for-byte what it was: the random source is read only for the faults that
  are on, in a fixed order (link, drop, malformed, duplicate, reorder, delay).
- **Malformed replaces the good message** rather than adding a bad one: a device that breaks the contract has lost that reading, and "a share of
  the messages" stays true. Ingest records a `seq` only after `parsePayload` succeeded, so the replaced message is also a **gap**: with malformed
  on, `telemetry_sequence_gaps_total` rises from it as well as from drop, and the effect panel must not credit gaps to Drop alone. Ten generators,
  one per rejection reason of `parsePayload` and `topic` (from `parseTopic`), built from `METRICS` and `MAX_PAYLOAD_BYTES` of the contract, each
  tested against the contract's own parser. The ingest-only reasons are not generated.
- **Burst** sends valid messages with `ts` spread over the next interval and refuses a count a device could not space, because the readings'
  key is `(device_id, metric, ts)`: the same `ts` for all would make ingest store one and count the rest as `duplicate` (a load test that looks
  like a data test), and one interval per message would cross ingest's 5-minute `future` window after 150 messages. At most 5,000, one at a time,
  chunks of 250, outside the switches, inside the scope.
- **Link loss** really ends the MQTT connection (`end(true)`, then `reconnect()`; checked against `mqtt@5.16.1`) so the broker and the Broker pill
  see it, and the messages built while it is down are lost, with their `seq`, which is ADR-0002's "bounded and measured" loss. The alternative,
  letting mqtt.js queue them and flush on reconnect, delivers them late without a gap, piles up pending publishes while it is down, and needs a
  bound the client does not give. `forS` is optional automatic restore; a restore waits up to 10 s for the broker.
- **Clearing.** Faults are in memory and end with the process. Clear all faults restores the link first (or what is flushed next would be
  dropped), switches everything off and sends what delay and reorder were holding; a stop (`SIGINT`, `SIGTERM`, `--duration`) does the same before
  it ends the client, so it loses no more than the operator asked for. `POST /api/reset` keeps its meaning (anomalies and held values) and does
  not clear faults: the amber pill is the reminder.
- **The effect session** (`fault-effect.ts`) keeps the time the first fault, burst or link loss was switched on and the four ingest counters
  then (read before the command; none if ingest had not been read), so a reload or a second tab shows the same "change since". It goes on after
  Clear all faults because ingest confirms a gap after `SEQUENCE_GRACE_MS` (30 s); "Reset counters" starts it again. Fault changes are
  `StateChange`s, hence timeline observations; `engine.faults` and `faultEffect` are part of the state view.
- **Security posture.** Nothing is written to disk and nothing authenticates, as before. What changed is what an unauthenticated caller on loopback
  can do: make the simulator publish invalid or bursty traffic (up to 5,000 messages per burst) to a broker that allows anonymous clients, and close
  its own connection to it. Same trust level as anomalies and held values, but the first command that generates load on demand; the table of
  [operations](../operations.md#security-posture) says so. Nothing was hardened here.
- **Scope kept narrow:** frame 07's switch model only. The Lab's nine tiles model a fault as timed and targeted (`startAt`, `duration`,
  `stagger`); the engine's settings do not preclude an automatic clear later (`forS` exists for link loss), but the Lab tiles are enabled, and
  link loss gets its row on the Faults page, in `SIM-12-ui`. "Silent" is `stop`/`pause`. No CLI flag was added (`--help` is unchanged).

## Amendment, 2026-10-23: the Faults page as built (SIM-12, Studio half)

The Faults page ([frame 07](../design/simulator/mockups/07-fault-injection.dc.html)) at `/lab/faults` switches the faults of the amendment of
2026-10-22 on and off and shows the pipeline counting them. It adds no dependency and no route to the simulator.

- **The engine is the only state.** The page holds no fault of its own: a switch is on when `engine.faults` says so, so the page is right after a reload and
  in a second tab. What it keeps is the _drafts_ of the values being edited (`useFaultDrafts`): a draft goes back to the engine's settings when they change
  under it (per fault, so an edit is not lost because another tab switched another fault) and when the simulator refuses a command. A value is sent when it is
  done (a slider released, a number confirmed or blurred, a chip pressed), not on every step; a value the simulator would refuse is not sent and the words are under
  the field. A field that has focus drops what was typed when the value in force changes to something else, or a blur would send the refused value again.
- **Seven rows, not six, and a set, not a choice.** Frame 07 draws six rows and one malformed kind chosen among nine. The engine has link loss and takes a
  set of ten kinds (`empty` is a reason of the parser the frame left out), so the page has a link-loss row (an optional "restore after" before it is cut; the
  Broker pill turns by itself) and toggle chips with `aria-pressed`, at least one on. Delay and reorder, which the frame does not give controls, get two number
  fields and a window. The rows are in the frame's order with link loss last, and the controls of a fault show only while it is on.
- **The scope is the Lab's picker.** "Selected" opens the same `TargetPicker` (device, zone or class) and the engine gets device ids: a zone is expanded once,
  when it is sent, while the picker keeps showing the zone. "Selected" with nothing chosen sends nothing, because the simulator refuses an empty selection.
- **The effect panel does not guess.** It subtracts the simulator's baseline from the `metrics` slice (`lib/faultEffect.ts`). Before any fault there is a line, not
  zeros; without a baseline (ingest could not be read when the faults went on) the rows are "—" and a chip says so; a counter that went down (ingest restarted) is
  "—" and says so; a series ingest has not exported is 0. Readings are `result="stored"` and are said to be counted per metric; the subtitles name what can move a
  counter _now_ (gaps "from Drop, Malformed and Link loss"), where the frame's "from Drop messages" would have been wrong because a malformed payload leaves a gap
  as well; and a standing note says a gap is confirmed only after ingest's grace period (30 s by default), shown only while a fault that makes gaps is on. The session
  goes on after Clear all faults.
- **The header pill** ("Faults on · n active", amber, a link to the page) is the fifth pill, added by `derivePills` only while `activeCount > 0` and left out of the
  dependency group; with nothing on, the four pills are as they were. A burst is not counted (it is a one-shot).
- **The Lab's tiles** keep Breach as the only one it injects: the Lab's fault has a start and a length, the engine's other faults are switches with a scope and no
  clock, so the seven disabled tiles say "A switch, not a timed fault: set it on the Faults page" (Silent: pause or stop the device in the Fleet) and the note links to
  the page. Making them timed faults would be an engine feature (an automatic clear on the switches), not a Studio one.
- **Timelines.** The seven new `engine-state` types have rows (source Engine, not a new source: the anomaly rows of the same kind are Engine's) and belong to the Lab
  log's Faults filter.
- **Limits are copied, and pinned.** The percentages, the delay, the window, the burst size, the restore time and the ten kinds are a copy of the simulator's
  (`lib/faultSettings.ts`, with a test that pins every number); the simulator enforces them and refuses with the field named, so a stale copy would show a wrong hint, not
  accept a wrong value. The four counters' names are copied once more in `lib/faultEffect.ts`, as `lib/ingestRates.ts` already copies its own.
- **A burst is up to 5,000 `published` events at once.** `stream.ts` is unchanged: it parses each (cheap), the history keeps its bound and tells its listeners at most once
  a second, and the rate shows the spike, which is true. A test sends 1,000 through `connectStream` and checks that. The `dropped` event and the `held` and `dropped`
  counts of the snapshot are not shown: they refresh only when something else changes, and the Message inspector (SIM-13) is where a dropped message belongs.
- **Not done here, left as they were:** a count field for the burst (the button is a fixed 1,000), timed or staggered faults, a fault from a scenario file, and the Twin's
  fault visuals (SIM-19).

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

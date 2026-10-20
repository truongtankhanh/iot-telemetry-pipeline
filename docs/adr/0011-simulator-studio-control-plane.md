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

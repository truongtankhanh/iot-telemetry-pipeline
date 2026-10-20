# Simulator Studio — implementation order

Status: **approved, revision 12** (2026-10-20; frames 00 to 19, see the [brief](brief.md)). The order in which the Studio frames get built. The design is in
[brief.md](brief.md), the frames in [mockups/](mockups/), the decision in
[ADR-0011](../../adr/0011-simulator-studio-control-plane.md).

The order follows three rules:

1. **Engine before screens.** Nothing in the UI can be demonstrated until the engine can be changed while it runs.
2. **Observe, then act, then compose.** The pages that show the system (Fleet, Topology, Alerts) come first, then the
   pages that change it (Scenarios, Lab), then the pages that bring both together (Overview, Guided demo).
3. **Heavy things last.** Faults, presenter mode and the benchmark come after the pages people use every time.

Each ticket is one branch and one pull request, as in the repository's roadmap (`feat/sim-<nn>-<slug>` from `main`).
`SIM-` is this plan's own prefix; a ticket can be given an `ITP-` number in the [roadmap](../../roadmap.md) when it is
committed to. "Frames" are the mockup frames it implements. All work stays inside the V1 demo scope: no
authentication is added and the broker and API stay as they are.

## Conventions for every ticket

These come from the review of the frames (revisions 4 to 12) and apply to each ticket below; a frame is not
implemented until its page meets them.

1. **Scale.** The scale rules of the brief hold: a page that draws devices has a designed state for 1 to 12, 13 to 60
   and more than 60 devices, and a table longer than 25 rows is paged (page and size in the URL, never infinite
   scroll).
2. **Time.** Seconds inside a scenario are written as plain seconds ("41 s", "alert at about 24 s"), never `t+41`, and
   say that they count from the scenario start the first time a page shows them.
3. **No overlap, no clipping.** Every label fits inside its block at 1920 px and at the wall scales; a label that does
   not fit is shortened or moved. A popover never covers the picture it belongs to.
4. **Electric style.** Edge light, state animation, hover and the pointer cursor come from the shared tokens and
   components of SIM-04, not from page CSS; the caps (24 glowing lines, 12 animated nodes), the 13 px text minimum and
   `prefers-reduced-motion` are tested once, in the shell.
5. **Copy.** A topic, a payload and a command each have a copy icon.
6. **Checked in a browser.** The frame is rendered next to the built page at 1920 px before the pull request is
   opened (the mockups are plain HTML and render in any current Chromium).

## Commands

Every ticket in the phase files ends with **Suggested commands**: the branch to create, what to read first, the checks to
run before the commit (throttled, one at a time), a manual check against the local stack, and a commit message in
English. The first time on a machine:

```bash
pnpm install
for d in . apps/ingest apps/simulator; do cp -n "$d/.env.example" "$d/.env"; done   # shared Compose ports and each app's settings
pnpm docker:up                                                                      # PostgreSQL + Mosquitto
```

`pnpm --filter @itp/simulator-ui ...` commands exist once SIM-04 has created the package. Commands that start a watcher
(`dev`) or the demo (`docker:demo`) are long-lived: stop them when the check is done. Heavy runs (the benchmark,
`pnpm ci:local`, the e2e suite) are never started alongside other work.

## Progress

| Ticket           | Status                                                     |
| ---------------- | ---------------------------------------------------------- |
| SIM-00           | Done 2026-10-19                                            |
| SIM-01           | Done 2026-10-20 (PR #46, `bcb036e`)                        |
| SIM-02           | In review 2026-10-20 (branch `feat/sim-02-extract-engine`) |
| SIM-03 to SIM-22 | Not started (SIM-03 is next; SIM-16 is not used)           |

Each task in the phase files carries its own **Status** line; update it, and this table, in the pull request that
finishes the ticket.

## Phase 0 — Decisions (gate)

| #      | Work                                                                                               | Done when                                                 |
| ------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| SIM-00 | Review the brief; accept ADR-0011; settle the open questions that block SIM-04 (light theme, port) | The ADR says **Accepted** and is listed in the docs index |

**SIM-01 (design brief and mockups, revision 12) is done:** merged to `main` on 2026-10-20 as PR #46 (squash,
`bcb036e`). SIM-00 was settled on 2026-10-19: ADR-0011 and ADR-0012 accepted, no light theme, port 3200. **SIM-02 can
start.**

## Phase 1 — Engine and control plane (no UI)

| #      | Ticket                                                                 | Frames | Depends on | Area                    |
| ------ | ---------------------------------------------------------------------- | ------ | ---------- | ----------------------- |
| SIM-02 | Extract the engine; runtime-editable devices, anomalies, shapes, clock | —      | SIM-00     | simulator               |
| SIM-03 | Control server: commands, event stream, ingest reads and observations  | —      | SIM-02     | simulator, docs         |
| SIM-04 | Studio shell: package, tokens, navigation, status components, Compose  | 00, 17 | SIM-03     | simulator-ui, ops, docs |

- **SIM-02**: move the loop out of `main.ts`; `DeviceSource` over `devices.json`; start, pause and stop per device;
  anomalies added and removed while running; ramp and spike shapes next to the existing step; a **simulated-clock
  mode** that makes Step and Reset possible and tests deterministic. The CLI output and flags do not change.
- **SIM-03**: HTTP commands and one SSE stream bound to `127.0.0.1`; polling of ingest `/api/alerts`, `/api/ready`
  and `/metrics`; an observation store that records when each state change was first seen (ingest has no delivery
  timestamp); `.env.example` and the simulator README updated together; the security-posture row.
- **SIM-04**: `apps/simulator-ui` (React, Vite, Vitest, Zustand), the tokens and status language of frame 00, the
  labelled navigation and the icon rail used from 1600 px, the wall scaling, the device-kind shapes and glyphs, dependency pills, the internal `/foundations` route; served by the
  simulator; the Compose `demo` profile publishes the port on `127.0.0.1`. Contrast check over the token pairs.

## Phase 2 — Observe

| #      | Ticket                                      | Frames     | Depends on | Area         |
| ------ | ------------------------------------------- | ---------- | ---------- | ------------ |
| SIM-05 | Device fleet and inspector                  | 01, 02, 18 | SIM-04     | simulator-ui |
| SIM-06 | Topology: nodes, edges, motion, down states | 04, 10     | SIM-04     | simulator-ui |
| SIM-07 | Alerts and the delivery trail               | 13         | SIM-04     | simulator-ui |

- **SIM-06** adds React Flow for the graph (a new dependency, justified in the ticket), the node and edge
  components for the five states, the layered neon edge (halo, core, pulse; dim and dashed when nothing flows, at most 24 glowing), dots driven by engine events with the caps in the brief, and the dependency-down
  states, and the scale rules of the brief for the graph (every node up to 12 devices, zone groups above, counts only above
  60). It also settles the chart library.
- **SIM-07** shows the incident link when the command center's console URL is configured (a new optional setting)
  and the plain id otherwise.

## Phase 3 — Act and compose

| #      | Ticket                                                    | Frames | Depends on             | Area          |
| ------ | --------------------------------------------------------- | ------ | ---------------------- | ------------- |
| SIM-08 | Scenarios: library, run, expected alerts                  | 03     | SIM-05                 | ui, simulator |
| SIM-09 | Overview: KPIs, live topology, alerts, controls, timeline | 11     | SIM-06, SIM-07, SIM-08 | simulator-ui  |
| SIM-10 | Simulation lab workspace                                  | 12, 19 | SIM-06, SIM-08         | ui, simulator |
| SIM-11 | Timeline editor and custom scenarios                      | 05     | SIM-08                 | ui, simulator |
| SIM-12 | Fault injection                                           | 07     | SIM-02, SIM-10         | simulator, ui |

- **SIM-08** adds the built-in scenarios as data (the two in `main.ts` today) and the computation of expected alerts
  from `rules.json`; custom scenarios are read-only here. **At the end of SIM-09 a demo can be given from Studio
  alone.**
- **SIM-10** is the three-zone workspace: configuration, the compact topology with the target highlighted, and the
  execution inspector with rule evaluation and reaction time.
- **SIM-11** settles where custom scenarios are stored (brief, open question 3) and validates them against the
  contract ranges before they can run.
- **SIM-12**: drop, duplicate, delay, reorder, malformed (one per contract rejection reason), burst and link loss,
  each with a unit test; the effect panel reads the counters named in the brief.

## Phase 4 — Inspect, present, measure

| #      | Ticket                         | Frames | Depends on     | Area                |
| ------ | ------------------------------ | ------ | -------------- | ------------------- |
| SIM-13 | Event stream                   | 06     | SIM-04         | simulator, ui       |
| SIM-14 | Guided demo and presenter mode | 08     | SIM-08, SIM-09 | simulator-ui        |
| SIM-15 | Analytics and the benchmark    | 09     | SIM-03         | simulator, ui, docs |

- **SIM-13** keeps the last 200 published messages in memory and offers "republish"; a republish keeps its `seq`.
- **SIM-14**: scripted steps with an awaited event, narration, keyboard control. The first script is
  "overheat to incident".
- **SIM-15**: session charts of rate, lag and rejections, and the benchmark run from the UI after a confirmation. It
  updates [benchmarks.md](../../benchmarks.md) only if the method changes and never records results by itself.

## Phase 5 — Digital twin

Proposed in [digital-twin.md](digital-twin.md) and [ADR-0012](../../adr/0012-simulator-studio-digital-twin.md); **the
approach was confirmed on 2026-10-19**; SIM-17 is a spike and can stop the phase.

| #      | Ticket                                                  | Frames     | Depends on             | Area                    |
| ------ | ------------------------------------------------------- | ---------- | ---------------------- | ----------------------- |
| SIM-17 | Spike: layout contract and a measured lazy scene        | 14 (part)  | SIM-06                 | simulator-ui, simulator |
| SIM-18 | Campus scene: buildings, pins, states, camera, fallback | 14, 16     | SIM-17                 | simulator-ui            |
| SIM-19 | Data flow, alert beacons and fault visuals              | 14         | SIM-18, SIM-07         | simulator-ui            |
| SIM-20 | Building focus and the heat floor                       | 15         | SIM-18                 | simulator-ui            |
| SIM-21 | Inject from the scene; camera steps in the guided demo  | 14, 15, 08 | SIM-19, SIM-12, SIM-14 | simulator-ui            |

- **SIM-17** adds `twin-layout.json` and its loader, a three.js canvas drawing the boundary and the extruded
  buildings, and measures the lazy chunk and the frame time on the reference laptop. It ends with a go or no-go
  written into ADR-0012; no-go falls back to an isometric 2D scene.
- **SIM-19** draws the fault table of the research page from engine state, with the caps on dots.

## Phase 6 — Close

| #      | Ticket                                                        | Frames | Depends on     | Area |
| ------ | ------------------------------------------------------------- | ------ | -------------- | ---- |
| SIM-22 | Docs, security-posture row, development guide and demo script | all    | SIM-15, SIM-21 | docs |

- **SIM-22**: README of the simulator, `docs/development.md` (the manual integration check becomes "open Studio"),
  `docs/operations.md` security posture, `docs/README.md` index, `docs/system-context.md`, and a keyboard-only and
  reduced-motion pass over every frame.

## Deferred

| Item                                         | Why                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3D models, parts and levels below a building | The command center's twin has them; Studio's twin is deliberately lean (ADR-0012). Revisit when that twin can be shared.                                                       |
| Light theme                                  | Not designed (brief, open question 1).                                                                                                                                         |
| Render level of detail for large fleets      | The scale rules and paging are designed and built (frames 11, 18, 19); drawing hundreds of nodes with zoom-dependent detail is not. State is kept per node so it can be added. |
| Delivery timestamps from ingest              | A small ingest change, not assumed (brief, open question 7).                                                                                                                   |

## Dependencies on other work

| Work                                                                    | Effect on Studio                                                                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [V2-T05](../../tasks/v2/V2-T05-simulator-replaces-occ-telemetry-sim.md) | Replaces `devices.json` with the catalogue and adds presence. Studio reads devices through `DeviceSource`; a "silent" device then maps to a real offline state. |
| ops-command-center V2 and its UI refresh                                | Studio's token values are the proposal for that refresh. The incident link depends on that console's URL scheme.                                                |
| [V1-T04](../../tasks/v1/V1-T04-unauthenticated-api-metrics-docs.md)     | If ingest gets authentication, Studio's reads need a token; the engine process is the only place that changes.                                                  |

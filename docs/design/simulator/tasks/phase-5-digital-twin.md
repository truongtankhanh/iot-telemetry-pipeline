# Phase 5 — Digital twin

Part of the [implementation order](../implementation-order.md). The approach is in
[digital-twin.md](../digital-twin.md) and [ADR-0012](../../../adr/0012-simulator-studio-digital-twin.md). The
approach was confirmed on 2026-10-19; SIM-17 is a spike and can stop the phase.

## SIM-17: Spike — layout contract and a measured lazy scene

- **Depends on:** SIM-06
- **Frames:** 14 (part)
- **Area:** `apps/simulator-ui`, `apps/simulator`

### Scope

1. `apps/simulator/config/twin-layout.json`: the command center's 20 zones and 31 catalogue assets (copied from its
   seed, with the source stated, assets marked `simulated: false`) and a position for each of Studio's devices, marked
   `illustrative` or `surveyed`; a loader and a schema.
2. A test that every device's `zone` exists in the layout and in `devices.json`, and that a device missing from the
   layout is reported, not dropped.
3. A three.js canvas under one folder, in its own lazy chunk, drawing the boundary and the extruded buildings with
   the command center's axes, footprint rule and material; the WebGL 2 check with the fallback to Topology.
4. Measurements, written into ADR-0012: the chunk size gzipped against the 350 KB budget, the frame time on the
   command center's reference laptop, the licences of the new dependencies, and the time the spike took.

### Acceptance criteria

- The chunk is not requested on any page except `/twin`.
- Either every exit criterion of ADR-0012 passes and the ADR says **go**, or one fails and the ADR says **no-go**
  and names the fallback.
- Pure helpers (layout parsing, projection) are covered by Vitest.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-17-twin-spike
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
# simulator half first (apps/simulator, node --test), then the UI half (apps/simulator-ui)
/steel-task-implement-nestjs-analyze SIM-17-sim docs/design/simulator/tasks/phase-5-digital-twin.md (section SIM-17 only and frames 14 (part) in docs/design/simulator/mockups/, the apps/simulator part)
/steel-task-implement-nestjs-plan SIM-17-sim
/steel-task-implement-nestjs-apply SIM-17-sim
/steel-task-implement-nestjs-verify SIM-17-sim
/steel-task-implement-react-analyze SIM-17-ui docs/design/simulator/tasks/phase-5-digital-twin.md (section SIM-17 only and frames 14 (part) in docs/design/simulator/mockups/, the apps/simulator-ui part)
/steel-task-implement-react-plan SIM-17-ui
/steel-task-implement-react-apply SIM-17-ui
/steel-task-implement-react-verify SIM-17-ui
/steel-review-self main SIM-17
/steel-git-commit                      # after you stage; or use the draft message below
```

The simulator is plain Node 24 with `node --test`, not NestJS: the NestJS-specific reference checks of the `nestjs` pipeline do not apply, its analyze, plan, apply and verify structure does (as for IMP-01.1). `steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/digital-twin.md`
- `docs/adr/0012-simulator-studio-digital-twin.md` (exit criteria)
- `docs/design/simulator/mockups/14-twin-campus.dc.html`

**While working**

```bash
pnpm --filter @itp/simulator-ui dev               # long-lived
```

**Verify before the commit** (one at a time; throttled)

```bash
pnpm --filter @itp/simulator lint && pnpm --filter @itp/simulator typecheck
pnpm --filter @itp/simulator exec node --test --test-concurrency=1 src/*.test.ts
pnpm --filter @itp/simulator-ui lint && pnpm --filter @itp/simulator-ui typecheck
pnpm --filter @itp/simulator-ui exec vitest run --maxWorkers=1
pnpm format:check && pnpm docs:links
pnpm --filter @itp/simulator-ui build && ls -l apps/simulator-ui/dist/assets | sort -k5 -n | tail -5
gzip -c apps/simulator-ui/dist/assets/<twin-chunk>.js | wc -c    # gzipped size against the 350 KB budget
```

**Check it by hand**

```bash
# frame time: open /twin on the reference laptop with DevTools Performance and record p95; write the result into ADR-0012
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the twin layout contract and a measured lazy scene (spike)
```

The ticket ends with a go or no-go written into ADR-0012 (amend it with a dated section).

## SIM-18: Campus scene

- **Depends on:** SIM-17
- **Frames:** 14, 16

### Scope

1. Pins for every device, shaped by kind (rounded square, circle, hexagon), building rims from the worst device state,
   the five states of frame 00, labels as DOM overlays with the kind's glyph and a cap on their number.
2. Camera: damped orbit, zoom to the cursor, pan, the tilt and target limits, presets _Campus_ and _Top_, flights of
   600 ms (instant under reduced motion).
3. Hover tooltip after 150 ms, click to select a building or a pin, Escape one level at a time, Home.
4. The _Topology | Twin_ switch on Topology, Overview and the Lab canvas, and the Catalogue layer: dim dashed markers
   for the nine assets the command center draws at campus level, labelled as not simulated.
5. The loading state with live pins on the flat plan, and the fallback banner with its reasons.
6. A visually hidden device list after the scene with the same names and states as Fleet.

### Acceptance criteria

- With the scene hidden, every value and state on the page is still available as text.
- Without WebGL 2, `/twin` shows Topology and the reason, and never an empty canvas.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-18-twin-campus
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-18 docs/design/simulator/tasks/phase-5-digital-twin.md (section SIM-18 only and frames 14, 16 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-18
/steel-task-implement-react-apply SIM-18
/steel-task-implement-react-verify SIM-18
/steel-review-self main SIM-18
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/14-twin-campus.dc.html`
- `docs/design/simulator/mockups/16-twin-loading-fallback.dc.html`
- `apps/simulator/config/twin-layout.json`

**While working**

```bash
pnpm --filter @itp/simulator-ui dev               # long-lived
```

**Verify before the commit** (one at a time; throttled)

```bash
pnpm --filter @itp/simulator-ui lint && pnpm --filter @itp/simulator-ui typecheck
pnpm --filter @itp/simulator-ui exec vitest run --maxWorkers=1
pnpm format:check && pnpm docs:links
```

**Check it by hand**

```bash
# fallback check: open /twin in a browser with WebGL disabled (for example Chrome with --disable-gpu) and confirm Topology and the reason appear
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the campus twin scene, camera and fallback
```

## SIM-19: Data flow, alert beacons and fault visuals

- **Depends on:** SIM-18, SIM-07
- **Frames:** 14

### Scope

1. The logical Pipeline hub, dashed and labelled, and an arc from each pin; dots driven by engine events, at most 4
   per arc and 24 on screen, none under reduced motion. Glowing arcs count against the same cap of 24 glowing lines as
   the 2D edges, and pins and beacons use the shared palette and edge-light tokens of SIM-04.
2. Beacons while an alert is open, in the alert's severity colour, with the alert chip on the label.
3. The fault table of the research page: silent, drop, delay, duplicate, malformed, burst and link loss, each drawn
   from engine state.

### Acceptance criteria

- Running `server-room-overheat` turns the pin and rim amber, then raises the beacon when the alert opens, and
  clears both when the alert clears.
- Switching a fault off removes its visual within one update.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-19-twin-data-flow
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-19 docs/design/simulator/tasks/phase-5-digital-twin.md (section SIM-19 only and frames 14 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-19
/steel-task-implement-react-apply SIM-19
/steel-task-implement-react-verify SIM-19
/steel-review-self main SIM-19
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/digital-twin.md` (fault table)
- `docs/design/simulator/mockups/14-twin-campus.dc.html`

**While working**

```bash
pnpm --filter @itp/simulator-ui dev               # long-lived
```

**Verify before the commit** (one at a time; throttled)

```bash
pnpm --filter @itp/simulator-ui lint && pnpm --filter @itp/simulator-ui typecheck
pnpm --filter @itp/simulator-ui exec vitest run --maxWorkers=1
pnpm format:check && pnpm docs:links
```

**Check it by hand**

```bash
pnpm docker:up                                    # PostgreSQL + Mosquitto
pnpm --filter @itp/ingest dev                     # terminal 1, long-lived (Ctrl+C when done)
pnpm --filter @itp/simulator start -- --scenario server-room-overheat   # terminal 2: pin and rim turn amber, the beacon rises with the alert, both clear with it
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add twin data flow, alert beacons and fault visuals
```

## SIM-20: Building focus and the heat floor

- **Depends on:** SIM-18
- **Frames:** 15

### Scope

1. Focusing a building: see-through walls, the rest of the campus faded, the breadcrumb and the Escape ladder.
2. The devices inside, at their `illustrative` or `surveyed` positions, with the device inspector and the rule
   thresholds, and the building's catalogue assets as dashed boxes (footprints from the command center's classes) with
   a list of what else stands there.
3. The heat layer in the command center's sequential ramp, interpolated between sensors and labelled so; a building
   with no temperature device is hatched, not coloured.

### Acceptance criteria

- The heat legend states that the floor is interpolated.
- A building whose devices report no temperature (for example `hub-power-01`) shows "no temperature data".

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-20-twin-building
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-20 docs/design/simulator/tasks/phase-5-digital-twin.md (section SIM-20 only and frames 15 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-20
/steel-task-implement-react-apply SIM-20
/steel-task-implement-react-verify SIM-20
/steel-review-self main SIM-20
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/15-twin-building.dc.html`
- `docs/design/simulator/digital-twin.md` (heat floor)

**While working**

```bash
pnpm --filter @itp/simulator-ui dev               # long-lived
```

**Verify before the commit** (one at a time; throttled)

```bash
pnpm --filter @itp/simulator-ui lint && pnpm --filter @itp/simulator-ui typecheck
pnpm --filter @itp/simulator-ui exec vitest run --maxWorkers=1
pnpm format:check && pnpm docs:links
```

**Check it by hand**

```bash
# open /twin, focus the Data Center, and check the heat legend says "interpolated"; focus a building with no temperature device and check "no temperature data"
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the twin building focus and heat floor
```

## SIM-21: Inject from the scene; camera steps in the guided demo

- **Depends on:** SIM-19, SIM-12, SIM-14
- **Frames:** 14, 15, 08

### Scope

1. "Inject here" on the selected device posts the Lab's command; there is no second path.
2. The guided demo can name a camera preset in a step; the camera moves only when the step says so.
3. A line in the demo script that names the command center's twin as a second screen.

### Acceptance criteria

- An injection from the scene and the same injection from the Lab produce the same alert.
- The guided demo's "overheat to incident" can run entirely from the twin.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-21-twin-inject
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-21 docs/design/simulator/tasks/phase-5-digital-twin.md (section SIM-21 only and frames 14, 15, 08 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-21
/steel-task-implement-react-apply SIM-21
/steel-task-implement-react-verify SIM-21
/steel-review-self main SIM-21
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/08-guided-demo.dc.html`
- `docs/design/simulator/tasks/phase-3-act-and-compose.md` (SIM-10, SIM-12)

**While working**

```bash
pnpm --filter @itp/simulator-ui dev               # long-lived
```

**Verify before the commit** (one at a time; throttled)

```bash
pnpm --filter @itp/simulator-ui lint && pnpm --filter @itp/simulator-ui typecheck
pnpm --filter @itp/simulator-ui exec vitest run --maxWorkers=1
pnpm format:check && pnpm docs:links
```

**Check it by hand**

```bash
pnpm docker:up                                    # PostgreSQL + Mosquitto
pnpm --filter @itp/ingest dev                     # terminal 1, long-lived (Ctrl+C when done)
pnpm --filter @itp/simulator start                # terminal 2
# inject a breach from the scene, then the same breach from the Lab, and compare:
curl -s "localhost:3100/api/alerts?limit=2"
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): inject faults from the twin and add camera steps to the guided demo
```

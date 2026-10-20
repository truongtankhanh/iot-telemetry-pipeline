# Phase 3 — Act and compose

Part of the [implementation order](../implementation-order.md). At the end of SIM-09 a demo can be given from Studio
alone.

## SIM-08: Scenarios

- **Depends on:** SIM-05
- **Frames:** 03

### Scope

1. The library with built-in scenarios (the two in `main.ts`) as data, and custom ones read from storage.
2. Run and stop; a second scenario touching the same device asks to replace the first.
3. Expected alerts computed from `rules.json` and the publish interval (the alert opens at the third publish tick
   at or after the anomaly starts, and clears at the first tick after it ends), and drawn on each card as a chart: the
   value over time against the raise and clear lines, the alert and the clear as flags, a playhead and the elapsed
   part tinted while it runs; if the file is not readable the card says
   so instead of showing a guess.
4. Running a scenario starts a stopped device it needs, and the card says that beforehand.
5. Paging: search by name, device or rule, sort (recently run, name, duration), source tabs with counts, 6, 12 or 24 cards
   per page, and the Fleet table's pager; search, tab, sort, page and size are in the URL.

### Acceptance criteria

- For `server-room-overheat` the expected alert is "Server room temperature high", and the real alert in ingest
  matches it within the stated tolerance on a demo run (record the observed times in the PR).
- Importing a scenario with an out-of-range value is refused with the reason.
- With 38 scenarios the library shows one page of cards, the right count per tab, and a reload returns to the same page.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-08-scenarios
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
# simulator half first (apps/simulator, node --test), then the UI half (apps/simulator-ui)
/steel-task-implement-nestjs-analyze SIM-08-sim docs/design/simulator/tasks/phase-3-act-and-compose.md (section SIM-08 only and frames 03 in docs/design/simulator/mockups/, the apps/simulator part)
/steel-task-implement-nestjs-plan SIM-08-sim
/steel-task-implement-nestjs-apply SIM-08-sim
/steel-task-implement-nestjs-verify SIM-08-sim
/steel-task-implement-react-analyze SIM-08-ui docs/design/simulator/tasks/phase-3-act-and-compose.md (section SIM-08 only and frames 03 in docs/design/simulator/mockups/, the apps/simulator-ui part)
/steel-task-implement-react-plan SIM-08-ui
/steel-task-implement-react-apply SIM-08-ui
/steel-task-implement-react-verify SIM-08-ui
/steel-review-self main SIM-08
/steel-git-commit                      # after you stage; or use the draft message below
```

The simulator is plain Node 24 with `node --test`, not NestJS: the NestJS-specific reference checks of the `nestjs` pipeline do not apply, its analyze, plan, apply and verify structure does (as for IMP-01.1). `steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/03-scenario-library.dc.html`
- `apps/ingest/config/rules.json`
- `apps/simulator/src/main.ts` (the two built-in scenarios)

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
```

**Check it by hand**

```bash
pnpm docker:up                                    # PostgreSQL + Mosquitto
pnpm --filter @itp/ingest dev                     # terminal 1, long-lived (Ctrl+C when done)
pnpm --filter @itp/simulator start                # terminal 2
# run server-room-overheat from Studio, then compare the card's expected times with the real alert:
curl -s "localhost:3100/api/alerts?limit=1"       # opened/cleared times; record them in the pull request
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the scenario library with expected alerts and paging
```

## SIM-09: Overview

- **Depends on:** SIM-06, SIM-07, SIM-08
- **Frames:** 11

### Scope

1. The KPI row: devices online with availability, active alerts by severity, message rate, ingest lag.
2. The compact live topology, sharing the node and edge components of SIM-06, grouped by zone above 12 devices (the
   scale rules in the brief): expand in place, _Problems only_, search, worst state per group, and line width by
   device count.
3. The alert feed and the event timeline, from the same sources as Alerts and the observation store. The timeline is a
   paged table in the style of CloudWatch Logs: a filter field, relative ranges (5m, 30m, 1h, 3h, 12h, Custom), local or
   UTC time, numbered pages at the top and the bottom with a rows-per-page choice, expandable rows, a density strip whose
   handles set the range, and export. Page, size and range live in the URL. The store keeps the last 5,000 events of the
   session.
4. Simulation controls: scenario picker, run, pause, **step** and **reset** (simulated-clock mode from SIM-02), and a
   progress bar of three named phases (normal, anomaly, recovery) with the alert flags, the playhead with its time and
   two lines saying what has happened and what comes next.
5. Studio opens on this page.

### Acceptance criteria

- Every figure on the page equals the figure on its detail page at the same moment.
- With 100 simulated devices the live topology shows zone groups, never one node per device, and the event timeline
  still pages.
- With ingest down the KPIs that depend on it say "unknown", not zero.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-09-overview
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-09 docs/design/simulator/tasks/phase-3-act-and-compose.md (section SIM-09 only and frames 11 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-09
/steel-task-implement-react-apply SIM-09
/steel-task-implement-react-verify SIM-09
/steel-review-self main SIM-09
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/11-overview.dc.html`
- `docs/design/simulator/brief.md` (Scale rules, What revision 11 changed)

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
pnpm --filter @itp/simulator start                # terminal 2; open Studio on Overview
curl -s localhost:3100/metrics | grep -E '^telemetry_(messages|readings|rejections|sequence_gaps)'   # each KPI must equal the matching figure
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the Overview with live topology, alerts, controls and event timeline
```

## SIM-10: Simulation lab workspace

- **Depends on:** SIM-06, SIM-08
- **Frames:** 12, 19

### Scope

1. The icon-rail layout with three zones: fault configuration, the canvas with the target highlighted, the
   execution inspector.
2. Configuration: the target picker (scope Device, Zone or Class; chips; a popover with search, All, Playing and Problems
   tabs, grouping by zone, tri-state zone checkboxes, "Show n more"; catalogue assets listed but not selectable) and the
   metric, fault type, parameters, trigger (with a stagger when more than one device is targeted) and stop condition; **Add to timeline**
   and **Inject now**. The stagger is start offsets computed when the command is built; the engine needs no change.
3. The expected-impact strip, computed from the rules.
4. The execution inspector: log, rule evaluation with the reaction time (first breaching reading to alert opened),
   and the trace as far as it is observable.
5. At more than 60 devices (frame 19): the canvas becomes a scrolling zone list with a state bar per zone and a zone
   table under it; the timeline draws one lane per zone group; the log filters, collapses alike events and pages;
   rule evaluation and trace step through the targets one at a time. The target popover is never wider than the
   configuration column.
6. The timeline dock, with an entry to the editor: a ruler, a lane per device with the value drawn against its raise
   line, the window in which each alert is expected to be open, and a playhead with its time.

### Acceptance criteria

- With 100 simulated devices and a fault on 12 of them, the Lab shows no overlapping or clipped block at 1920 px, and
  scrolling the zone list never moves the pipeline.
- Injecting a breach from the workspace produces the same alert as the equivalent scenario.
- Stages that cannot be timed say _seen at_ or _not timed_; none shows an invented duration.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-10-simulation-lab
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-10 docs/design/simulator/tasks/phase-3-act-and-compose.md (section SIM-10 only and frames 12, 19 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-10
/steel-task-implement-react-apply SIM-10
/steel-task-implement-react-verify SIM-10
/steel-review-self main SIM-10
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/12-simulation-lab.dc.html`
- `docs/design/simulator/mockups/19-simulation-lab-100.dc.html`
- `docs/design/simulator/brief.md` (What revision 12 changed)

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
```

**Check it by hand**

```bash
pnpm docker:up                                    # PostgreSQL + Mosquitto
pnpm --filter @itp/ingest dev                     # terminal 1, long-lived (Ctrl+C when done)
pnpm --filter @itp/simulator start                # terminal 2
# inject a breach from the Lab, then check the alert equals the scenario's:
curl -s "localhost:3100/api/alerts?status=open"
# 100-device check: point the simulator at a registry with 100 devices (the fixture is made in this ticket)
pnpm --filter @itp/simulator start -- --registry <path-to-100-device-devices.json>
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the Simulation lab workspace with scale handling
```

## SIM-11: Timeline editor and custom scenarios

- **Depends on:** SIM-08
- **Frames:** 05

### Scope

1. Lanes per device with a kind shape and the metric, anomaly blocks that can be selected, moved and resized with
   snap and handles, the value drawn inside each block against the raise line, an Alerts lane showing when each
   expected alert is open, a ruler with major and minor ticks, and a playhead. Above 12 anomalies the lanes group by zone as in the Lab's dock
   (frame 19): one lane per group with a thin bar per device, expandable.
   The value is drawn as a neon line (halo, glow, core; amber inside an anomaly) and the playhead glows, as in the
   data lines of frame 04; any moving spark is switched off under `prefers-reduced-motion`.
2. The inspector: device, metric, shape (step, ramp, spike), value, start, duration; a preview against the rule
   thresholds; the expected-alerts table.
3. Decide and implement where custom scenarios live (brief, open question 3). Whatever the choice, a scenario is a
   plain JSON document that can be exported and imported.
4. Validation against the contract ranges before a scenario can run.

### Acceptance criteria

- A scenario built in the editor, saved, reloaded and run produces the anomalies drawn.
- The same JSON can still be expressed as the `--anomaly` flags of the CLI, or the gap is written down.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-11-timeline-editor
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
# simulator half first (apps/simulator, node --test), then the UI half (apps/simulator-ui)
/steel-task-implement-nestjs-analyze SIM-11-sim docs/design/simulator/tasks/phase-3-act-and-compose.md (section SIM-11 only and frames 05 in docs/design/simulator/mockups/, the apps/simulator part)
/steel-task-implement-nestjs-plan SIM-11-sim
/steel-task-implement-nestjs-apply SIM-11-sim
/steel-task-implement-nestjs-verify SIM-11-sim
/steel-task-implement-react-analyze SIM-11-ui docs/design/simulator/tasks/phase-3-act-and-compose.md (section SIM-11 only and frames 05 in docs/design/simulator/mockups/, the apps/simulator-ui part)
/steel-task-implement-react-plan SIM-11-ui
/steel-task-implement-react-apply SIM-11-ui
/steel-task-implement-react-verify SIM-11-ui
/steel-review-self main SIM-11
/steel-git-commit                      # after you stage; or use the draft message below
```

The simulator is plain Node 24 with `node --test`, not NestJS: the NestJS-specific reference checks of the `nestjs` pipeline do not apply, its analyze, plan, apply and verify structure does (as for IMP-01.1). `steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/05-timeline-editor.dc.html`
- `packages/telemetry-contract/src/index.ts` (ranges)
- `apps/simulator/src/main.ts` (--anomaly flag format)

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
```

**Check it by hand**

```bash
pnpm docker:up                                    # PostgreSQL + Mosquitto
# build a scenario in the editor, save, reload, run; then export its JSON and run the same anomalies from the CLI:
pnpm --filter @itp/simulator start -- --anomaly dc-env-01:temperature_c:29.2:45:60 --duration 120
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the timeline editor and custom scenarios
```

## SIM-12: Fault injection

- **Depends on:** SIM-02, SIM-10
- **Frames:** 07

### Scope

1. Engine faults: drop (the `seq` still advances), duplicate, delay with jitter, reorder within a window, malformed
   payloads (one generator per rejection reason of `parsePayload`), burst, and link loss (the simulator's own
   connection to the broker).
2. A scope (all running, or selected devices) and a header pill that is amber while any fault is on.
3. The effect panel: change since the fault was switched on of `telemetry_sequence_gaps_total`,
   `telemetry_rejections_total{reason}`, `telemetry_messages_total` and `telemetry_readings_total`.
4. "Clear all faults", and clearing on exit.

### Acceptance criteria

- Each malformed generator is rejected by `parsePayload` with exactly its reason (a unit test per reason, using the
  contract package, not a copy of the rules).
- With drop at 5 % over a demo run, the gap counter rises and the readings counter does not account for the dropped
  messages.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-12-fault-injection
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
# simulator half first (apps/simulator, node --test), then the UI half (apps/simulator-ui)
/steel-task-implement-nestjs-analyze SIM-12-sim docs/design/simulator/tasks/phase-3-act-and-compose.md (section SIM-12 only and frames 07 in docs/design/simulator/mockups/, the apps/simulator part)
/steel-task-implement-nestjs-plan SIM-12-sim
/steel-task-implement-nestjs-apply SIM-12-sim
/steel-task-implement-nestjs-verify SIM-12-sim
/steel-task-implement-react-analyze SIM-12-ui docs/design/simulator/tasks/phase-3-act-and-compose.md (section SIM-12 only and frames 07 in docs/design/simulator/mockups/, the apps/simulator-ui part)
/steel-task-implement-react-plan SIM-12-ui
/steel-task-implement-react-apply SIM-12-ui
/steel-task-implement-react-verify SIM-12-ui
/steel-review-self main SIM-12
/steel-git-commit                      # after you stage; or use the draft message below
```

The simulator is plain Node 24 with `node --test`, not NestJS: the NestJS-specific reference checks of the `nestjs` pipeline do not apply, its analyze, plan, apply and verify structure does (as for IMP-01.1). `steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/07-fault-injection.dc.html`
- `packages/telemetry-contract/src/index.ts` (parsePayload rejection reasons)
- `docs/telemetry-contract.md`
- `apps/ingest/src/metrics/metrics.ts`

**Verify before the commit** (one at a time; throttled)

```bash
pnpm test:contract
pnpm --filter @itp/simulator lint && pnpm --filter @itp/simulator typecheck
pnpm --filter @itp/simulator exec node --test --test-concurrency=1 src/*.test.ts
pnpm --filter @itp/simulator-ui lint && pnpm --filter @itp/simulator-ui typecheck
pnpm --filter @itp/simulator-ui exec vitest run --maxWorkers=1
pnpm format:check && pnpm docs:links
```

**Check it by hand**

```bash
pnpm docker:up                                    # PostgreSQL + Mosquitto
pnpm --filter @itp/ingest dev                     # terminal 1, long-lived (Ctrl+C when done)
pnpm --filter @itp/simulator start                # terminal 2; switch on drop at 5 % from Studio for a minute
curl -s localhost:3100/metrics | grep -E '^telemetry_(sequence_gaps|rejections|readings)_total'   # gaps rise, readings do not count dropped messages
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator): add engine faults and the effect panel
```

A malformed generator needs a unit test per rejection reason that uses the contract package, not a copy of the rules.

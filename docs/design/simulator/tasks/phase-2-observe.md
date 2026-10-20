# Phase 2 — Observe

Part of the [implementation order](../implementation-order.md). The pages that show the system, before the pages that
change it.

## SIM-05: Device fleet and inspector

- **Depends on:** SIM-04
- **Status:** Not started
- **Frames:** 01, 02, 18

### Scope

1. KPIs and a sticky toolbar (search, zone, kind, sort, group by zone, Cards or Table). Up to 12 devices: cards with live
   values and per-device start, pause, stop. Above 12: a table (frame 18) with state tabs and counts, row selection and a
   bulk bar (pause, start, stop, hold a value, select all), sortable columns, a sparkline, a pager (10 to 100 rows) and
   a column chooser; above 60 the same table pages on the server. Sort, filters, page and size live in the URL. Each card carries a chart
   of the last 2 minutes for the chosen metric (tabs for the others): labelled axes, the rule's raise and clear
   lines with the headroom to them in words, the part above the raise line in amber, the alert as a flag on the
   line, the last value as a tag, min, average and max beneath, and a hatched gap with the reason when a device is
   paused or silent.
2. The inspector sheet, 680 px: topic and last payload each with a copy icon, mode (simulated or hold value), interval,
   and a panel per metric with the Fleet chart at full width, a range bar (safe zone, hysteresis band, alarm zone,
   baseline, current value) and baseline, noise and daily swing.
3. The running-scenario strip, once SIM-08 provides scenarios, with a **Follow** menu: Topology (device selected, path to
   the incident lit), Digital twin (building in focus, device pinned) and the alert (cause and delivery trail).
4. Values and units come from `METRICS` in the telemetry contract; a value outside the contract range cannot be
   entered here (use Faults for that).
5. The bulk bar's _Hold a value_ opens a small dialog that is not mocked; it reuses the inspector's hold control and
   is drawn in this ticket. Frames 01, 02 and 15 still draw an alert marker on the chart (a bell, a band, rings) while
   frame 04 does not: the state is shown beside the device name instead (brief, open question 9).

### Acceptance criteria

- Pausing, stopping and holding a value on a device changes what ingest receives.
- Every control is reachable with the keyboard and has an accessible name.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-05-device-fleet
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-05 docs/design/simulator/tasks/phase-2-observe.md (section SIM-05 only and frames 01, 02, 18 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-05
/steel-task-implement-react-apply SIM-05
/steel-task-implement-react-verify SIM-05
/steel-review-self main SIM-05
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/01-fleet-overview.dc.html`
- `docs/design/simulator/mockups/02-device-inspector.dc.html`
- `docs/design/simulator/mockups/18-fleet-table.dc.html`
- `packages/telemetry-contract/src/index.ts` (METRICS)

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
pnpm --filter @itp/simulator start                # terminal 2 (Studio's control server)
# in Studio: pause a device, then
docker compose exec mosquitto mosquitto_sub -t 'campus/+/<deviceId>/telemetry' -v -C 3   # nothing arrives while it is paused
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the device fleet, table at scale and inspector
```

## SIM-06: Topology

- **Depends on:** SIM-04
- **Status:** Not started
- **Frames:** 04, 10

### Scope

1. The graph in React Flow: zones as groups, the five node states of frame 00, directed edges, zoom controls and the
   legend. React Flow is a new dependency; the ticket records its licence and bundle cost and why a hand-written
   graph is not preferred.
2. The neon edge: a custom React Flow edge of three layers (halo, core, pulse), cyan, amber or green by state, and a
   dim dashed wire with no glow when nothing flows or the link is down. At most 24 glowing edges. Dots on edges are
   driven by engine events, at most 4 per edge, none under reduced motion.
3. Selecting a node fills the row under the graph in three columns: the device detail (metric tabs, the chart, the range bar, actions), the rule evaluation and the alerts. Nothing is drawn over the graph except the minimap; the toolbar
   above it holds the live state, the grouping, _Problems only_, search, collapse all, zoom and fit.
4. Dependency-down states: ingest unreachable (stages dashed, last answer dimmed and dated), no alert sink,
   broker disconnected.
5. The chart library decision (brief, open question 6), with the bundle measured.
6. The scale rules of the brief for the graph: every node up to 12 devices; above that a zone is one node with its count,
   worst state and chevron (expand in place, line width by device count); above 60 a zone shows counts only and a
   device is reached by search or _Problems only_. The worst state of a group is the worst of its devices.
7. The state of the selected device is a note beside its name; the chart carries no alert marker.
8. No _Twin_ control yet: the _Topology | Twin_ switch arrives with SIM-18.

### Acceptance criteria

- Running `server-room-overheat` changes the states in order: device, rules, alert, outbox, command center. With
  `OCC_API_URL` unset on ingest the last node says "not configured".
- Stopping ingest produces the frame 10 state within the polling interval, and starting it again recovers without a
  page reload.
- State updates re-render only the nodes that changed.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-06-topology
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-06 docs/design/simulator/tasks/phase-2-observe.md (section SIM-06 only and frames 04, 10 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-06
/steel-task-implement-react-apply SIM-06
/steel-task-implement-react-verify SIM-06
/steel-review-self main SIM-06
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/04-topology-live.dc.html`
- `docs/design/simulator/mockups/10-dependency-down.dc.html`
- `docs/design/simulator/brief.md` (Scale rules)

**While working**

```bash
pnpm --filter @itp/simulator-ui dev               # long-lived
```

**Verify before the commit** (one at a time; throttled)

```bash
pnpm --filter @itp/simulator-ui lint && pnpm --filter @itp/simulator-ui typecheck
pnpm --filter @itp/simulator-ui exec vitest run --maxWorkers=1
pnpm format:check && pnpm docs:links
pnpm --filter @itp/simulator-ui build && ls -l apps/simulator-ui/dist/assets | sort -k5 -n | tail -5   # bundle sizes for the React Flow note
```

**Check it by hand**

```bash
pnpm docker:up                                    # PostgreSQL + Mosquitto
pnpm --filter @itp/ingest dev                     # terminal 1, long-lived (Ctrl+C when done)
pnpm --filter @itp/simulator start -- --scenario server-room-overheat   # terminal 2: states change in order, alert at about 24 s
# dependency-down check: stop ingest (Ctrl+C in terminal 1) and watch frame 10's state appear, then start it again
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the live topology with neon edges and dependency-down states
```

Record React Flow's licence and bundle cost in the pull request.

## SIM-07: Alerts

- **Depends on:** SIM-04
- **Status:** Not started
- **Frames:** 13

### Scope

1. The alert list, paged by cursor (Newer, Older, a page size from 5 to 200, no page numbers or totals because the API
   gives none), with filters by status and severity, and the delivery state of each (`delivered`, `pending`,
   `failed`, `skipped`).
2. The detail: the cause (rule, readings, and the Studio scenario that produced it when there is one) and the
   delivery trail from first breach to incident.
3. The incident link when the command center's console URL is configured; the plain id otherwise.
4. Times after the alert are taken from the observation store and labelled as observed.

### Acceptance criteria

- An alert raised by a Studio scenario names that scenario; one raised by anything else does not claim a cause.
- Paging uses the `X-Next-Cursor` header as documented in [api.md](../../../api.md), never a built cursor.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-07-alerts
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-07 docs/design/simulator/tasks/phase-2-observe.md (section SIM-07 only and frames 13 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-07
/steel-task-implement-react-apply SIM-07
/steel-task-implement-react-verify SIM-07
/steel-review-self main SIM-07
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/13-alerts.dc.html`
- `docs/api.md` (GET /api/alerts, X-Next-Cursor)
- `apps/ingest/src/alerts/`

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
pnpm --filter @itp/simulator start -- --scenario server-room-overheat --duration 120   # terminal 2
curl -si "localhost:3100/api/alerts?limit=1" | grep -i "x-next-cursor"                 # paging must use this header, never a built cursor
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the alerts list and delivery trail
```

# Phase 1 — Engine and control plane

Part of the [implementation order](../implementation-order.md). Nothing here has a page of its own except the shell.

## SIM-02: Extract the engine

- **Depends on:** SIM-00
- **Status:** Done 2026-10-20 (PR #49, `1edc97f`)
- **Area:** `apps/simulator`

### Scope

1. Move the publish loop of [main.ts](../../../../apps/simulator/src/main.ts) into an engine module with no
   process or argument handling in it.
2. A `DeviceSource` interface; the first implementation reads `devices.json`.
3. Per device: start, pause, stop, interval, hold a value. Anomalies are added and removed while running.
4. Anomaly shapes: the existing step plus ramp and spike (in [signals.ts](../../../../apps/simulator/src/signals.ts),
   with tests next to the existing ones).
5. A **simulated-clock mode**: time advances only when told to, so Step (one publish interval) and Reset (anomalies
   cleared, baseline restored) are possible, and tests are deterministic (seeded random, injected clock).
6. An event emitter for state changes and published messages (the source of the SSE stream in SIM-03).
7. `main.ts` and `bench.ts` call the engine; flags, output and exit behaviour stay exactly as they are.

### Acceptance criteria

- A test that runs the old CLI scenario `server-room-overheat` against a fake clock produces the same messages as
  before the change.
- Starting and stopping a device, adding an anomaly while running, Step and Reset are covered by `node --test` tests.
- `pnpm test:simulator`, `lint` and `typecheck` pass for the package.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-02-extract-engine
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-nestjs-analyze SIM-02 docs/design/simulator/tasks/phase-1-engine-and-control-plane.md (section SIM-02 only)
/steel-task-implement-nestjs-plan SIM-02
/steel-task-implement-nestjs-apply SIM-02
/steel-task-implement-nestjs-verify SIM-02
/steel-review-self-nestjs main SIM-02
/steel-git-commit                      # after you stage; or use the draft message below
```

The simulator is plain Node 24 with `node --test`, not NestJS: the NestJS-specific reference checks of the `nestjs` pipeline do not apply, its analyze, plan, apply and verify structure does (as for IMP-01.1). The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `apps/simulator/src/main.ts`
- `apps/simulator/src/signals.ts`
- `apps/simulator/src/bench.ts`
- `apps/simulator/src/signals.test.ts`

**Verify before the commit** (one at a time; throttled)

```bash
pnpm --filter @itp/simulator lint && pnpm --filter @itp/simulator typecheck
pnpm --filter @itp/simulator exec node --test --test-concurrency=1 src/*.test.ts
```

**Check it by hand**

```bash
pnpm docker:up                                    # PostgreSQL + Mosquitto
pnpm --filter @itp/simulator start -- --scenario server-room-overheat --duration 30   # CLI output and flags must be unchanged
docker compose exec mosquitto mosquitto_sub -t 'campus/#' -v -C 5   # five messages, then it exits
```

**Commit message** (draft; Sếp commits it)

```text
refactor(simulator): extract the publish loop into an engine module
```

The CLI must behave exactly as before: compare its output with `main` by running the same command on both.

## SIM-03: Control server

- **Depends on:** SIM-02
- **Status:** In review 2026-10-20 (branch `feat/sim-03-control-server`)
- **Area:** `apps/simulator`, docs

### Scope

1. An HTTP server in the simulator process, bound to `127.0.0.1` by default: JSON commands for devices, scenarios
   and anomalies, and one server-sent-events stream (state and the publish log).
2. Polling of ingest `GET /api/alerts`, `GET /api/ready` and `/metrics` with a short timeout, about once a second.
   Ingest is not modified.
3. An **observation store**: when Studio first saw an alert open, its delivery become `delivered`, and an incident id
   appear. `/api/alerts` has no delivery timestamp, so these are the times the UI shows, labelled as observed. The store also keeps
   the last 5,000 events of the session, which the Overview timeline (SIM-09) pages through.
4. `apps/simulator/.env.example` and the simulator README gain the new settings together (listen address and port,
   ingest URL, command center console URL).
5. The row for the control surface in the security-posture table of [operations.md](../../../operations.md).

### Acceptance criteria

- With ingest stopped, the stream reports it as unreachable within the polling interval and keeps publishing.
- The server refuses to start on a non-loopback address unless a variable explicitly allows it, and says so.
- The commands are covered by tests with the engine in deterministic mode.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-03-control-server
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-nestjs-analyze SIM-03 docs/design/simulator/tasks/phase-1-engine-and-control-plane.md (section SIM-03 only)
/steel-task-implement-nestjs-plan SIM-03
/steel-task-implement-nestjs-apply SIM-03
/steel-task-implement-nestjs-verify SIM-03
/steel-review-self-nestjs main SIM-03
/steel-git-commit                      # after you stage; or use the draft message below
```

The simulator is plain Node 24 with `node --test`, not NestJS: the NestJS-specific reference checks of the `nestjs` pipeline do not apply, its analyze, plan, apply and verify structure does (as for IMP-01.1). The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/adr/0011-simulator-studio-control-plane.md`
- `docs/api.md` (GET /api/alerts, /api/ready)
- `docs/operations.md` (Security posture)
- `apps/simulator/.env.example`

**Verify before the commit** (one at a time; throttled)

```bash
pnpm --filter @itp/simulator lint && pnpm --filter @itp/simulator typecheck
pnpm --filter @itp/simulator exec node --test --test-concurrency=1 src/*.test.ts
pnpm format:check && pnpm docs:links
```

**Check it by hand**

```bash
pnpm docker:up                                    # PostgreSQL + Mosquitto
pnpm --filter @itp/ingest dev                     # terminal 1, long-lived (Ctrl+C when done)
pnpm --filter @itp/simulator start                # terminal 2; control server on 127.0.0.1:3200 (--control-host, --control-port, --ingest-url, --no-control)
curl -s localhost:3100/api/ready                  # what the control server polls
curl -s "localhost:3100/api/alerts?limit=5"
curl -s localhost:3200/api/state | head -c 600    # the control server's own view: engine, devices, ingest, alerts
curl -N localhost:3200/api/stream                 # terminal 3, long-lived (Ctrl+C when done): snapshot, then state, published, ingest, metrics
curl -s -X POST -H 'Content-Type: application/json' -d '{}' localhost:3200/api/scenarios/server-room-overheat/run   # an alert opens in about 25 s
# then, with ingest stopped (Ctrl+C in terminal 1), the stream must report it unreachable within the polling interval
# (an `ingest` event with "status":"unreachable", about two seconds at most) and `published` events must go on
```

The refusal and the headless mode (stop the simulator first; each must exit or run as described):

```bash
CONTROL_HOST=0.0.0.0 pnpm --filter @itp/simulator start        # must refuse, name CONTROL_ALLOW_NON_LOOPBACK, exit 1, before the broker
pnpm --filter @itp/simulator start -- --no-control --scenario server-room-overheat --duration 30   # output as before SIM-03
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator): add the control server with an SSE stream and an observation store
```

The server must refuse a non-loopback address unless a variable allows it: check that by hand with the variable unset.

## SIM-04: Studio shell

- **Depends on:** SIM-03
- **Status:** Not started
- **Frames:** 00, 17
- **Area:** `apps/simulator-ui`, ops, docs

### Scope

1. The `apps/simulator-ui` package (React, Vite, Zustand, Vitest), added to the pnpm workspace and to `pnpm build`,
   `lint`, `typecheck` and `test`.
2. `studio.css` tokens as the app's token file; the Lucide `Icon` wrapper; Geist and JetBrains Mono bundled with
   the app (no request to a font host from a demo machine).
3. The command palette (frame 17): matches pages, devices, zones, alerts, scenarios, topics and actions, with the
   prefixes `d:`, `a:`, `s:` and `>`, in the browser on lists Studio already holds. The shell: labelled navigation below 1600 px and the icon rail from 1600 px (pinnable), wall scaling at 2560 and
   3200 px, the header with dependency pills, the clock, `⌘ K` search and go-to. No maximum content width.
4. The status language of frame 00 as components (pill, chip, severity badge, node state), the device identity (a
   shape and a glyph per kind, a code per device, an icon per metric) and the internal `/foundations` route.
5. The simulator serves the built files; the Compose `demo` profile publishes the port on `127.0.0.1`.
6. A contrast check over the token pairs, as in the command center's console, run by `lint`, including text on a 12 %
   neon tint and the neon colours on surface-2 (4.5:1 or more).
7. The electric style of frame 00 as the shared tokens and components: edge-light tokens, the state animations
   (breathing, pulse, flicker) behind one `prefers-reduced-motion` switch, a pointer cursor and a hover, pressed and
   focus state for every control that acts, a hover row on tables, and the lit pager; a test counts animated nodes and
   glowing lines against the caps (12 and 24).
8. `ci.yml` and `scripts/ci-local.sh` change together if CI gains a step.

### Acceptance criteria

- `pnpm docker:demo` serves Studio on Overview; the pills show broker, ingest and command center states correctly,
  including ingest down and no alert sink.
- No existing script needs the UI to be built.
- `pnpm build`, `lint`, `typecheck`, `test` and `format:check` pass at the root.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-04-studio-shell
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-04 docs/design/simulator/tasks/phase-1-engine-and-control-plane.md (section SIM-04 only and frames 00, 17 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-04
/steel-task-implement-react-apply SIM-04
/steel-task-implement-react-verify SIM-04
/steel-review-self main SIM-04
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/studio.css`
- `docs/design/simulator/mockups/Main.dc.html`
- `apps/ingest/eslint.config.mjs` (lint style to copy)
- `scripts/ci-local.sh and .github/workflows/ci.yml` (change together)

**While working**

```bash
pnpm install                                      # after adding apps/simulator-ui to the workspace
pnpm --filter @itp/simulator-ui dev               # Vite dev server, long-lived (stop it when done)
```

**Verify before the commit** (one at a time; throttled)

```bash
pnpm exec turbo run build lint typecheck --concurrency=2
pnpm --filter @itp/simulator-ui lint && pnpm --filter @itp/simulator-ui typecheck
pnpm --filter @itp/simulator-ui exec vitest run --maxWorkers=1
pnpm format:check && pnpm docs:links
```

**Check it by hand**

```bash
pnpm docker:demo                                  # builds and runs ingest and the simulator in containers; Ctrl+C stops it
# open http://127.0.0.1:3200 and check the dependency pills
pnpm docker:demo:down
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the Studio shell, tokens and status components
```

`pnpm docker:demo` builds images and is heavy: close other containers first. If CI gains a step, change `ci.yml` and `scripts/ci-local.sh` together, then run `pnpm ci:local --fast` (throttled; it runs the CI jobs on this machine).

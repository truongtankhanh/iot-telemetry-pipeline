# Phase 4 — Inspect, present, measure

Part of the [implementation order](../implementation-order.md).

## SIM-13: Event stream

- **Depends on:** SIM-04
- **Frames:** 06

### Scope

1. The last 200 published messages in memory, filtered by text, device and metric; pause and clear. Numbered paging
   (10, 25, 50, 100 rows); page 1 follows live and leaving it pauses the tail.
2. Detail: topic, payload, size, PUBACK time, and the equivalent `mosquitto_pub` command.
3. Republish with the same `seq`.

### Acceptance criteria

- A republished message is stored once by ingest (the readings counter does not grow), shown in the faults panel.
- The tail stays responsive at the benchmark's rate by sampling, and says that it is sampling.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-13-event-stream
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
# simulator half first (apps/simulator, node --test), then the UI half (apps/simulator-ui)
/steel-task-implement-nestjs-analyze SIM-13-sim docs/design/simulator/tasks/phase-4-inspect-present-measure.md (section SIM-13 only and frames 06 in docs/design/simulator/mockups/, the apps/simulator part)
/steel-task-implement-nestjs-plan SIM-13-sim
/steel-task-implement-nestjs-apply SIM-13-sim
/steel-task-implement-nestjs-verify SIM-13-sim
/steel-task-implement-react-analyze SIM-13-ui docs/design/simulator/tasks/phase-4-inspect-present-measure.md (section SIM-13 only and frames 06 in docs/design/simulator/mockups/, the apps/simulator-ui part)
/steel-task-implement-react-plan SIM-13-ui
/steel-task-implement-react-apply SIM-13-ui
/steel-task-implement-react-verify SIM-13-ui
/steel-review-self main SIM-13
/steel-git-commit                      # after you stage; or use the draft message below
```

The simulator is plain Node 24 with `node --test`, not NestJS: the NestJS-specific reference checks of the `nestjs` pipeline do not apply, its analyze, plan, apply and verify structure does (as for IMP-01.1). `steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/06-message-inspector.dc.html`
- `docs/telemetry-contract.md` (section 8, publish by hand)

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
pnpm --filter @itp/simulator start                # terminal 2; republish one message from Studio, then:
curl -s localhost:3100/metrics | grep -E '^telemetry_readings_total'   # must not grow for the republished (same seq) message
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the event stream with republish
```

## SIM-14: Guided demo and presenter mode

- **Depends on:** SIM-08, SIM-09
- **Frames:** 08

### Scope

1. A script format: steps with a title, narration, an action (start a scenario, hold a value) and an awaited event
   (rule raised, alert opened, incident delivered, alert cleared).
2. The presenter view, keyboard control, and automatic advance when the awaited event happens, with a manual
   override.
3. The first script, "overheat to incident", in six steps.

### Acceptance criteria

- The script runs end to end against a local stack without touching the mouse.
- A step whose awaited event does not happen says what it is still waiting for, and offers to move on.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-14-guided-demo
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
/steel-task-implement-react-analyze SIM-14 docs/design/simulator/tasks/phase-4-inspect-present-measure.md (section SIM-14 only and frames 08 in docs/design/simulator/mockups/)
/steel-task-implement-react-plan SIM-14
/steel-task-implement-react-apply SIM-14
/steel-task-implement-react-verify SIM-14
/steel-review-self main SIM-14
/steel-git-commit                      # after you stage; or use the draft message below
```

`steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/08-guided-demo.dc.html`
- `docs/design/simulator/brief.md` (guided demo)

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
# run "overheat to incident" end to end with the keyboard only; no mouse
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator-ui): add the guided demo and presenter mode
```

## SIM-15: Analytics and the benchmark

- **Depends on:** SIM-03
- **Frames:** 09

### Scope

1. Session charts of message rate, ingest lag, flush time and buffered readings, from ingest `/metrics`, with units, the
   time window always shown, and the benchmark's phases (ramp-up, steady state) marked. Published and stored share
   one chart, and the gap between them is labelled as what is still in flight.
2. The benchmark: settings, pre-flight checks (ingest ready, database reachable, fleet paused) and an explicit
   confirmation that says what the run costs.
3. Progress for published and stored, throughput, ingest lag and flush time. Decide whether it runs in a child
   process (brief, open question 4).
4. The fleet controls are locked while it runs; Stop is always available. Results live for the session and can be
   downloaded.

### Acceptance criteria

- The numbers on the page equal what `pnpm --filter @itp/simulator bench` prints for the same settings.
- Closing the browser tab does not leave a benchmark running without a way to stop it.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-15-analytics-benchmark
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
# simulator half first (apps/simulator, node --test), then the UI half (apps/simulator-ui)
/steel-task-implement-nestjs-analyze SIM-15-sim docs/design/simulator/tasks/phase-4-inspect-present-measure.md (section SIM-15 only and frames 09 in docs/design/simulator/mockups/, the apps/simulator part)
/steel-task-implement-nestjs-plan SIM-15-sim
/steel-task-implement-nestjs-apply SIM-15-sim
/steel-task-implement-nestjs-verify SIM-15-sim
/steel-task-implement-react-analyze SIM-15-ui docs/design/simulator/tasks/phase-4-inspect-present-measure.md (section SIM-15 only and frames 09 in docs/design/simulator/mockups/, the apps/simulator-ui part)
/steel-task-implement-react-plan SIM-15-ui
/steel-task-implement-react-apply SIM-15-ui
/steel-task-implement-react-verify SIM-15-ui
/steel-review-self main SIM-15
/steel-git-commit                      # after you stage; or use the draft message below
```

The simulator is plain Node 24 with `node --test`, not NestJS: the NestJS-specific reference checks of the `nestjs` pipeline do not apply, its analyze, plan, apply and verify structure does (as for IMP-01.1). `steel-unit-react-scan apps/simulator-ui` then `-evaluate`, `-plan` and `-apply` write the unit tests for logic-heavy pieces (hooks, stores, pure helpers); `-apply` runs the tests it writes, so you run it yourself. The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/design/simulator/mockups/09-benchmark.dc.html`
- `docs/benchmarks.md`
- `apps/simulator/src/bench.ts`

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
# heavy: this saturates the broker and the CPU, run it alone and close other work first
pnpm --filter @itp/simulator bench -- --messages 100000    # reference numbers to compare with the page
```

**Commit message** (draft; Sếp commits it)

```text
feat(simulator): add analytics and the benchmark run to Studio
```

The benchmark is resource-intensive: run it once, on an otherwise idle machine, and never in parallel with tests.

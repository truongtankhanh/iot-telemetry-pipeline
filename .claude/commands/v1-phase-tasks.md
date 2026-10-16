---
description: Break one phase of docs/improvement/implementation-order.md into a detailed, ordered task list and write it to docs/improvement/tasks/phase-<n>-<slug>.md
argument-hint: <phase 0-5 | all> [--refresh]
allowed-tools: Read, Grep, Glob, Write, Edit, Bash(git log:*), Bash(git rev-parse:*), Bash(git status:*), Bash(ls:*), Bash(date:*), Bash(npx prettier:*), Bash(pnpm exec prettier:*)
---

# V1 improvement phase → task list

Arguments: `$ARGUMENTS`

- First argument: the phase number from `docs/improvement/implementation-order.md` (`0` … `5`), or `all` to do every
  phase in order, one file each. **Required.** If it is missing or not a phase in that file, stop and ask.
- `--refresh`: the phase file already exists and must be brought up to date (see Step 6). Without it, an existing
  file is never overwritten: stop and ask.

You are the tech lead preparing work for the team. The output is a task list that a developer, or an implement
pipeline, can pick up task by task without re-reading the whole repository. Accuracy beats volume: every file path,
symbol, table, metric and environment variable you mention must exist in the repo or be clearly marked **new**.

This repository is V1, a demonstration system, not intended for production. Write each task against that scope and
do not widen it: production-only hardening belongs in the plan's "Deferred" section, not in a task.

## Ground rules

- **Read-only on the codebase.** The only files you write are the phase files under `docs/improvement/tasks/`. Do
  not edit code, ADRs, `implementation-order.md`, `docs/tasks/**` or any other doc. If one of them is wrong or
  contradicts another, record it under "Open questions" in the phase file instead.
- **Do not run tests, builds, dev servers, benchmarks, containers or migrations.** Reading files and `git log` are
  enough. Tests are run by the maintainer, never by you: for every task, list the tests to add or change and the
  exact commands to run them, and leave the running to the maintainer.
- **Do not commit or push.**
- **No fabrication.** If something cannot be confirmed from the repo (a file, a number, a behaviour), say so in the
  task (`unverified`, or an open question). Items the plan marks _unverified_ stay unverified until their own task
  confirms them: write that confirmation as the task's first acceptance criterion and give the task a fallback
  ("if not reproduced: close with the evidence, change nothing").
- **No performance claims without a baseline.** A task in the optimization phase quotes the IMP-11 baseline and states
  the measurement it must beat; it never promises a speed-up in advance.
- **English** for the whole phase file (it is a team document). Code identifiers stay as they are in the repo.

## Step 1 — Read the sources

Read, in this order, and keep notes of what each says about the phase:

1. `docs/improvement/implementation-order.md` — the phase's tickets (`IMP-xx`), their priority, "Depends on", the bullet
   that describes each ticket and its evidence files, the parallel-tracks diagram, the survey → ticket table, and the
   Deferred and Notes sections.
2. The ADRs a ticket cites or contradicts: `docs/adr/0001-*.md` … `docs/adr/0010-*.md` (0001 shared subscriptions,
   0002 ack on receipt, 0003 partitions and rollups, 0004 rules, 0005 outbox, 0006 client credentials, 0008 API docs
   switch, 0009 and 0010 contract checks). When a ticket changes behaviour an ADR describes, the task says whether
   to amend the ADR.
3. The existing risk tasks: `docs/tasks/v1/README.md` and the `V1-Txx` files a ticket overlaps (`V1-T01`, `V1-T02`,
   `V1-T03`, `V1-T04`). Do not re-open a task that is marked Done; cite it.
4. `docs/roadmap.md` for the `ITP-*` tickets a ticket closes or overlaps (for example IMP-19 and ITP-12).
5. **The format references**: `docs/tasks/v1/V1-T02-failed-flush-drops-batch.md` (Problem → Evidence → Impact →
   Options → Resolution) for tone and evidence style, and the command center's phase files if they are available at
   `../ops-command-center/docs/design/v2/tasks/` (read-only, optional) for the task template. Copy structure, not
   content.
6. The code each ticket changes, to ground every task in real files:
   - service: `apps/ingest/src/**` — `app.module.ts`, `config/env.validation.ts`, `database/database.ts`,
     `database/errors.ts`, `database/migrations/*.sql`, `telemetry/*` (`mqtt-consumer.service.ts`,
     `batch-writer.service.ts`, `sequence-ledger.ts`, `rollup.ts`), `rules/*`, `delivery/*`, `devices/*`, `alerts/*`,
     `health/*`, `metrics/metrics.ts`, `maintenance/*`, `configure-app.ts`, `main.ts`;
   - tests: `apps/ingest/src/**/*.spec.ts`, `apps/ingest/test/**` (e2e, contract fixtures), `jest.config.ts`;
   - shared contract: `packages/telemetry-contract/src/index.ts` and its tests;
   - simulator and benchmarks: `apps/simulator/src/**`, `deploy/bench/**`, `docs/benchmarks.md`;
   - ops: `docker-compose.yml`, both `Dockerfile`s, `deploy/k8s/**`, `deploy/mosquitto/mosquitto.conf`, `scripts/*.sh`;
   - CI and tooling: `.github/workflows/*.yml`, `eslint.config.mjs`, `turbo.json`, `package.json` scripts, `.nvmrc`;
   - docs: `README.md`, `docs/*.md` (`api.md`, `configuration.md`, `operations.md`, `architecture.md`,
     `telemetry-contract.md`, `development.md`).
     Use Grep and Glob; open only what you need. Note the existing pattern each task should follow (for example how
     `V1-T01` added migration `002_sequence_ledger.sql`, how `BatchWriter` classifies errors with `isDataError`).
7. `git log --oneline -20` and `git rev-parse --short HEAD`, to stamp the file and to see what already landed.

## Step 2 — Decide the tasks

Break **each ticket of the phase** into tasks. A task is the smallest change that can be reviewed and merged on its own
(one PR, ideally under ~400 changed lines, green on its own). A ticket is often a single task; split it only when the
parts can land and be reviewed independently.

- **ID:** `IMP-<ticket>.<n>`, for example `IMP-03.1`, `IMP-03.2`, numbered in the order they should start. A ticket
  with one task still gets `.1`.
- **Tests with the change.** The test that proves a fix is part of the same task as the fix. A separate task exists
  only for test infrastructure other tasks depend on (IMP-06, IMP-07).
- **Typical order inside a ticket:** failing test or reproduction → fix → config and docs (`docs/configuration.md`,
  `.env.example`, `docs/operations.md`, ADR amendment) → metrics and logs.
- **Contract and schema changes.** For every change to `@itp/telemetry-contract`, an environment variable, a metric
  name or a migration, say how an older replica meets a newer one during a rolling deploy (the Deployment uses
  `maxSurge: 1`, so both run at once), what must deploy first, and whether the migration is forward-only (it always
  is, per `docs/operations.md`).
- **Production-safety.** If a task could make a mock or no-op component boot silently in a real environment, say so in
  its acceptance criteria. Treat it as blocking, not as a nice-to-have.
- **Size** each task S (≤ ½ day), M (≤ 2 days) or L (> 2 days; split it unless it truly cannot be split, and say why).
- Phase 0 (decisions) still gets tasks: accept each convention the plan proposes, settle the Deferred list, and add
  the links from `docs/README.md` and `docs/roadmap.md` (written as a task, not done by this command).

## Step 3 — Write each task

Use this template for every task. Leave no field empty; write "None" where nothing applies.

```markdown
### IMP-03.1 — <imperative title>

**Ticket.** IMP-03 · **Priority.** P0 · **Area.** ingest | contract | simulator | ops | ci | docs · **Size.** S | M | L
**Depends on.** IMP-02.1 · **Parallel with.** IMP-04.1 · **Survey.** A1 · **Decisions.** ADR-0004, V1-T02

**Problem.** What is wrong or missing today, with evidence from the repo (file and symbol). If the plan marks it
_unverified_, say what would confirm it.

**Scope.**

- Concrete changes, each naming the file to edit or create (`new`), the symbol, and the pattern to follow.
- Data: migration name, columns, indexes, `NOT NULL` and default handling, what happens to existing rows.
- Config: new environment variables with name, type, default and range in `env.validation.ts`, and the cross-field
  checks (as `bufferProblems` does).
- Metrics and logs: names, types and labels (small fixed sets, never device ids); log level and wording.
- Docs: files to update (`docs/configuration.md`, `docs/operations.md`, `docs/api.md`, ADR amendment section).

**Out of scope.** What a reader might expect here but belongs to another task (name it).

**Acceptance criteria.**

- [ ] Checkable statements, one behaviour each, including the failure and rolling-deploy cases.
- [ ] Tests to add or update, by file name (unit, e2e, contract), and what each asserts.
- [ ] Commands the maintainer runs, complete and copy-pasteable, with the environment they need (for e2e:
      `pnpm e2e:ingest`; for one spec: `pnpm --filter @itp/ingest exec jest <path>` with `NODE_OPTIONS`
      as in `apps/ingest/package.json`).
- [ ] Measurement (optimization tasks only): the IMP-11 baseline quoted, the command that measures, and the result
      that counts as an improvement. If it is not reached, the change is not merged.

**Risks and rollout.** Deploy order, migration lock time on `device` or `alert_delivery`, behaviour during a rolling
deploy, how to roll back (forward-only: write the compensating migration or the revert).

**Suggested pipeline.** `steel-task-implement-nestjs-analyze IMP-03.1` → `-plan` → `-apply` → `-verify` for service
code (the `-verify` step needs the maintainer to run lint, build and tests and paste the output); `steel-unit-nestjs-*`
or `steel-e2e-nestjs-*` where tests are the work; `steel-docker-refactor-*` for Dockerfile and Compose tasks;
`steel-ci-*-github` for workflow tasks.

**Status.** Not started.
```

## Step 4 — Assemble the phase file

Write `docs/improvement/tasks/phase-<n>-<slug>.md` (slug from the phase title in `implementation-order.md`, for example
`phase-1-correctness-fixes.md`, `phase-3-measure-then-optimize.md`). Create the `tasks/` folder if needed. Structure:

1. **Title and header**: `# Phase <n> — <title>: tasks`; status (`proposed`), generated date (`date +%F`), `main` at
   `<short sha>`, a link to `implementation-order.md`, and the ADRs and `V1-Txx` tasks used. One paragraph on what the
   phase delivers and what "done" means for the phase.
2. **Before you start**: the gate (tickets this phase waits for), environment prerequisites (Docker for e2e, the
   `*_test` database guard from V1-T03, ports in `.env.example`), and the working agreement: one branch and one PR per
   task, Conventional Commits with the task ID in the scope or body, the PR description links the task, tests are run
   by the maintainer.
3. **Task index**: a table — ID, title, ticket, priority, area, size, depends on, parallel with, survey, status.
4. **Order and parallel lanes**: a text diagram of the dependencies (lanes such as contract, ingest, test, ops, ci,
   docs) and the critical path in one line.
5. **Tasks**, grouped under `## IMP-xx — <ticket title>` headings in ticket order, each task in the template above.
6. **Cross-cutting checklist** for the phase: `lint`, `typecheck` and `format:check` clean; no new dependency without
   a stated reason; no change to a metric name or label without a docs update; `docs/configuration.md` and
   `.env.example` in step with `env.validation.ts`; ADR amended when behaviour changes; no secrets in tests or docs;
   rolling-deploy compatibility.
7. **Open questions**: anything unverified, any contradiction between the plan, the ADRs, the docs and the code, with
   the task it blocks.

Formatting: GitHub Markdown, tables aligned by Prettier, no emoji except the status legend (✅ done, ◐ partly done)
when refreshing.

## Step 5 — Check before saving

- Every ticket of the phase in `implementation-order.md` has at least one task, and every survey item the phase's
  tickets list is covered by some task's **Survey** field.
- Every **Depends on** points to a task that exists (in this phase or an earlier phase's file) and the order has no
  cycle; nothing depends on a later task in the list. A dependency on an earlier phase whose file does not exist yet
  is written as the ticket (`IMP-07`), not a task ID.
- Every existing path you cite exists (Glob it); every new path is marked `new`. Every environment variable, metric
  and table you cite exists in `env.validation.ts`, `metrics.ts` or the migrations, or is marked `new`.
- No task mixes unrelated work to save a PR; no task is L without a reason.
- Optimization tasks carry a measurement; correctness tasks carry a failing test or a reproduction.
- The file contains no secrets, no credentials and no data copied from a real site.

## Step 6 — Save, format, report

- If the file exists and `--refresh` was not given: stop and ask before touching it.
- With `--refresh`: keep every task's **Status** and any notes a person added; update the rest from the sources; add new
  tasks at their place in the order with new IDs (never renumber or reuse an ID); mark tasks that no longer apply as
  `Status. Dropped — <reason>` instead of deleting them.
- Run `npx prettier --write docs/improvement/tasks/<file>` (or `pnpm exec prettier`), then `--check`, and report the
  result.
- For `all`, repeat Steps 2–6 for each phase in order; later phases may depend on earlier phases' task IDs.

Finish with a short summary **in Vietnamese** to the user, addressing them as "Sếp" and yourself as "em": the file(s)
written, the number of tasks per ticket, the critical path, the open questions, and anything unverified. Do not paste
the task list into the chat.

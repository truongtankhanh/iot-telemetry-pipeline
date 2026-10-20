# IoT Telemetry Pipeline

## Project snapshot

Sensor telemetry from a campus, ingested over MQTT 5, stored in PostgreSQL (daily partitions plus
one-minute rollups), turned into alerts with hysteresis, and delivered through a transactional outbox
as incidents to ops-command-center. It is one of three repositories (this one,
`ops-command-center`, `platform-aws`).

**This is a V1 demonstration system, not intended for production.** The broker allows anonymous
clients, the HTTP API and `/metrics` have no authentication, and some limits are known and
documented. Do not harden or "fix" these as a side effect of another change: they are listed in
`docs/operations.md` ("Security posture", "Known limitations").

## Tech stack

| Surface  | Stack                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------- |
| Repo     | pnpm 10 workspaces (`apps/*`, `packages/*`) + Turborepo, Node 24 (`.nvmrc`), TypeScript ~5.9      |
| Service  | `apps/ingest`: NestJS 12, `pg` (plain SQL, no ORM), `mqtt`, `prom-client`, Jest 30                |
| Contract | `packages/telemetry-contract` (`@itp/telemetry-contract`): topic and payload parser, tsup, Vitest |
| Load     | `apps/simulator`: synthetic devices and the benchmark, runs `.ts` directly, `node --test`         |
| Studio   | `apps/simulator-ui`: React 19, Vite, Zustand, CSS Modules, Vitest (jsdom); built to static files  |
| Ops      | Docker Compose, Kubernetes (kustomize), GitHub Actions, Prometheus rules and a Grafana dashboard  |

## Directory map

- `apps/ingest/src/` one folder per concern: `telemetry/` (MQTT consumer, batch writer, sequence
  ledger, rollups), `rules/`, `delivery/` (outbox worker and the command-center sink), `devices/` and
  `alerts/` (read API), `health/`, `metrics/`, `maintenance/` (partitions), `database/` (pool,
  `migrations/*.sql`), `config/` (`env.validation.ts`), `logging/`, `openapi/`.
- `apps/ingest/config/` `devices.json` and `rules.json`, read at boot. `apps/ingest/test/` the e2e suite
  and its helpers; `test/contract/` holds snapshots of the other repositories.
- `apps/simulator/src/` the engine, the control server (`control-*.ts`, which also serves the built Studio) and the
  benchmark. `apps/simulator-ui/` Simulator Studio: `src/` (`shell/`, `palette/`, `pages/`, `state/`, `ui/`, `lib/`,
  `styles/tokens.css`), `scripts/` (contrast and text-size checks run by `lint`).
- `packages/telemetry-contract/src/index.ts` the one definition of topics, payloads and metric names.
- `deploy/` `mosquitto/`, `k8s/` (base and overlays), `observability/` (Prometheus rules, Grafana
  dashboard), `bench/` (benchmark and gap-check scripts).
- `docs/` the documentation (start at `docs/README.md`); `docs/adr/` the decision records;
  `docs/openapi.json` is generated.
- `scripts/` shell and Node helpers behind the `pnpm` scripts.

## Commands

Run from the repository root.

| Command                                              | What it does                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm install`                                       | Install (CI uses `--frozen-lockfile`)                                                  |
| `pnpm build` / `lint` / `typecheck` / `format:check` | Whole repository; Turborepo builds the contract first                                  |
| `pnpm test`                                          | Unit tests: Jest (ingest), Vitest (contract, Studio), `node --test` (simulator)        |
| `pnpm test:coverage`                                 | Ingest unit tests with coverage; fails below the floor in `apps/ingest/jest.config.ts` |
| `pnpm e2e:ingest`                                    | Starts PostgreSQL and Mosquitto, runs the e2e suite on `telemetry_test`                |
| `pnpm --filter @itp/simulator-ui dev`                | Studio dev server; proxies `/api` to a simulator on `:3200`                            |
| `pnpm docs:links`                                    | Checks relative links and anchors in the tracked Markdown files                        |
| `pnpm docs:openapi`                                  | Regenerates `docs/openapi.json` from the built controllers                             |
| `pnpm docker:up` / `docker:demo` / `docker:observe`  | Compose stack; the demo with a simulator; Prometheus and Grafana                       |
| `pnpm ci:local [--fast]`                             | The jobs of `ci.yml` on this machine, throttled                                        |
| `pnpm ci:off` / `ci:on` / `ci:status`                | Switch the repository variable `CI_ENABLED`                                            |
| `pnpm bench:baseline` / `bench:gaps:all`             | Single-replica baseline with a CPU profile; two-replica gap check                      |

One ingest spec: `NODE_OPTIONS=--experimental-vm-modules pnpm --filter @itp/ingest exec jest <path>`.
`apps/ingest` imports the contract from `dist/`: build it first (`pnpm --filter @itp/telemetry-contract build`)
when running a bare `jest`, `eslint` or `tsc` there.

## Conventions

- English for code, comments, documentation, commits. Conventional Commits; one change per pull request.
- Prettier (single quotes, 100 columns) covers Markdown too; `pnpm format:check` is part of CI.
- Typed ESLint rules `no-floating-promises` and `no-misused-promises` apply to `apps/ingest`; a deliberate
  fire-and-forget is written `void promise`.
- Configuration is validated at boot in `apps/ingest/src/config/env.validation.ts`. A new variable goes
  there, in `docs/configuration.md` and in the app's `.env.example`, together.
- Metric names and labels are an interface (platform-aws, the shipped alert rules and the dashboard read
  them): do not rename one without updating `deploy/observability/` and the parity test.
- Three test runners are used on purpose (Jest for ingest, Vitest for the contract and Studio, `node --test` for the
  simulator); do not unify them.
- Workflows: `permissions: contents: read`, `timeout-minutes` on every job, actions pinned to a commit SHA.

## Watch out for

- **The e2e suite drops the `public` schema** of its database and refuses any name that does not end in
  `_test` (`TEST_DATABASE_URL`, never `DATABASE_URL`).
- **Migrations are forward-only** plain SQL in `apps/ingest/src/database/migrations/`, applied at boot under
  an advisory lock. Replicas of two versions run at once during a rolling deploy.
- **Acknowledge on receipt** (ADR-0002): the consumer acknowledges before the write; loss is bounded and
  measured by `telemetry_sequence_gaps_total`.
- **A no-op component must not boot silently**: with `OCC_API_URL` unset the alert sink is a no-op and says
  so at boot and on `/api/ready`.
- **`docs/openapi.json` is generated**: change a route or DTO, then run `pnpm docs:openapi`; CI fails otherwise.
- **The broker image tag** `eclipse-mosquitto` has five copies (Compose, bench Compose, Kubernetes, `ci.yml`,
  `ci-local.sh`); change them together.
- **`ci.yml` and `scripts/ci-local.sh` change together.**

## Deeper references

`docs/README.md` (index), `docs/architecture.md`, `docs/operations.md`, `docs/configuration.md`,
`docs/api.md`, `docs/telemetry-contract.md`, `docs/development.md`, `docs/benchmarks.md`, `docs/adr/`.
Per-area rules are in `.claude/rules/`.

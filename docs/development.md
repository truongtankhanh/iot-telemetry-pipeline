# Development guide

Everything you need to change this codebase: setup, layout, tests, and recipes for the common
changes.

## Prerequisites

| Tool    | Version                                | Notes                                   |
| ------- | -------------------------------------- | --------------------------------------- |
| Node.js | 24 (`.nvmrc`; `engines: >=24`)         | The simulator runs `.ts` files natively |
| pnpm    | 10.28 (`packageManager`; use Corepack) | `corepack enable`                       |
| Docker  | Any recent                             | PostgreSQL and Mosquitto for local runs |

## Setup

```bash
corepack enable
pnpm install
for d in . apps/ingest apps/simulator; do cp -n "$d/.env.example" "$d/.env"; done
pnpm docker:up           # PostgreSQL on :5433, Mosquitto on :1883, and a `telemetry_test` database
```

Three `.env` files, one per place: the root one holds the Compose host ports, `apps/ingest/.env` and
`apps/simulator/.env` each hold that app's settings (see their READMEs:
[ingest](../apps/ingest/README.md), [simulator](../apps/simulator/README.md)). The Compose stack is
shared by both apps and by the e2e suite. `pnpm docker:down` stops it (the data volume is kept) and
`pnpm docker:restart` does both. If a host port is already taken on your machine (`address already in
use`), change `POSTGRES_HOST_PORT` / `MQTT_HOST_PORT` in the root `.env` and use the same ports in
the apps' `.env`.

Run the service and some traffic:

```bash
pnpm --filter @itp/ingest dev                                         # nest start --watch
pnpm --filter @itp/simulator start -- --scenario server-room-overheat
```

`dev` is a long-lived watch process; stop it when you are done.

## Repository layout

```
apps/
  ingest/                 NestJS service (the product)
    config/               devices.json, rules.json — runtime configuration, reviewed as code
    src/
      main.ts             bootstrap
      configure-app.ts    global prefix, validation, shutdown hooks, OpenAPI (shared with e2e)
      app.module.ts       module wiring and the alert-sink factory
      config/             env.validation.ts — every environment variable, validated at boot
      database/           pg Pool wrapper, transactions, migration runner, migrations/*.sql
      telemetry/          mqtt-consumer, batch-writer, rollup, sequence-ledger, mqtt-options
      rules/              rules-engine (pure), rules.service (state, alert rows, outbox rows)
      delivery/           delivery.worker (outbox), alert-sink, ops-command-center.sink,
                          client-credentials, backoff
      maintenance/        partition-maintenance.service, partitions (pure helpers)
      devices/            devices.service (registry) and the read API
      alerts/             alerts read API
      health/             liveness, readiness, /metrics
      metrics/            Prometheus registry
    test/                 e2e suite (real PostgreSQL + Mosquitto + a fake command center)
  simulator/              synthetic devices, scenarios, benchmark (plain Node, no build step)
packages/
  telemetry-contract/     topic layout + payload parser shared by devices, simulator and service
deploy/
  mosquitto/              broker config
  k8s/                    kustomize base + local overlay
docs/                     this documentation
```

### How the pieces connect

```mermaid
flowchart LR
  subgraph telemetry
    C[MqttConsumer] --> W[BatchWriter]
  end
  subgraph rules
    R[RulesService]
  end
  subgraph delivery
    D[DeliveryWorker] --> S{{AlertSink}}
  end
  C -- "parse, validate, count" --> Contract[(telemetry-contract)]
  W -- "stored readings" --> R
  W & R & D --> DB[(Database)]
  S --- OCC[OpsCommandCenterSink]
  S --- Noop[NoopSink]
```

Design choices worth knowing before you edit:

- **No ORM.** The ingest path is bulk SQL (`unnest` inserts, upserts), so queries are written
  directly against `pg` and migrations are plain, reviewed `.sql` files.
- **Pure logic is separated and unit-tested**: `evaluate`/`parseRules` (rules), `rollup`,
  `applySequences`, `nextDelayMs`, partition helpers, `mqttConnectOptions`, `parsePayload`.
- **The alert sink is an interface** (`AlertSink`); the factory in `app.module.ts` chooses
  `OpsCommandCenterSink` or `NoopSink` from the environment.
- **Every flush is one transaction** (insert → rollup → `last_seen` and sequence ledger), and rules run after commit
  on the rows that were actually inserted.

## Everyday commands

| Command                                                   | What it does                                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                                              | Builds every package through Turborepo (contract first)                                                              |
| `pnpm lint`                                               | ESLint across workspaces                                                                                             |
| `pnpm typecheck`                                          | `tsc --noEmit` across workspaces                                                                                     |
| `pnpm format` / `pnpm format:check`                       | Prettier (single quotes, trailing commas, 100 columns) over the whole repo                                           |
| `pnpm test`                                               | Unit tests (Jest for ingest, Vitest for the contract, `node --test` for the simulator)                               |
| `pnpm test:e2e`                                           | End-to-end suite — wipes `TEST_DATABASE_URL`, see below                                                              |
| `pnpm docker:up` / `docker:down` / `docker:restart`       | PostgreSQL and Mosquitto from Compose, shared by development and the e2e suite                                       |
| `pnpm docker:demo`                                        | The whole demo in containers: also builds the ingest service and starts a simulator (foreground)                     |
| `pnpm docker:demo:down`                                   | Removes the demo's ingest and simulator containers; PostgreSQL and Mosquitto keep running                            |
| `pnpm test:ingest` / `test:simulator` / `test:contract`   | Unit tests of one package (builds what it depends on first)                                                          |
| `pnpm e2e:ingest`                                         | `docker:up`, then the ingest e2e suite against the `telemetry_test` database                                         |
| `pnpm bench:gaps` / `pnpm bench:gaps:loss` / `…:all`      | Two-replica sequence-gap check, without and with broker loss ([benchmarks](benchmarks.md#gap-count-across-replicas)) |
| `pnpm --filter @itp/simulator bench -- --messages 100000` | End-to-end throughput benchmark ([benchmarks](benchmarks.md))                                                        |

Turborepo builds the contract package before anything that depends on it, so run `pnpm build` (or
any of the above) after editing `packages/telemetry-contract`.

CI (`.github/workflows/ci.yml`) runs format check, lint, typecheck, unit tests, e2e and build, then
validates the Kubernetes manifests with kubeconform and builds the Compose images.

### Running CI on your machine

`pnpm ci:local` runs the steps of `ci.yml` locally, in the same order, so a pull request does not
have to wait for GitHub's runners. `scripts/ci-local.sh` is the source; when the workflow changes,
change the script in the same pull request.

```bash
pnpm ci:local --fast          # format, lint, typecheck and unit tests only (Node and pnpm are enough)
pnpm ci:local --skip-images   # everything except the image build (needs Docker for e2e)
pnpm ci:local                 # the whole workflow: verify, manifests, images
```

| Option                                            | Effect                                                          |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `--fast`                                          | No install, e2e, build, manifests or images                     |
| `--only verify` / `manifests` / `images`          | One job                                                         |
| `--skip-e2e`, `--skip-manifests`, `--skip-images` | Leave one part out                                              |
| `--no-install`                                    | Skip `pnpm install --frozen-lockfile`                           |
| `--jobs N`                                        | Turbo concurrency and Jest workers (default 2)                  |
| `--keep-going`                                    | Run every step after a failure                                  |
| `--keep`                                          | Leave the throwaway PostgreSQL and Mosquitto containers running |
| `--fresh`                                         | Ignore Turborepo's cache (`--force`), as on a GitHub runner     |
| `--clean`                                         | Afterwards delete `.turbo/cache` and the images the run built   |

It ends with a table of every step, its time, the commit tested and whether the working tree was
clean. What differs from GitHub, on purpose:

- **e2e** runs against its own throwaway containers (`itp-ci-local-pg` on port 55433 with
  `telemetry_test`, and `itp-ci-local-mqtt` on port 51883, the repository's `mosquitto.conf`),
  through `TEST_DATABASE_URL` and `MQTT_URL`. It never touches the Compose stack of `pnpm docker:up`.
  Set `CI_LOCAL_PG_PORT` / `CI_LOCAL_MQTT_PORT` if a port is taken; the suite's fake command center
  always listens on 3199.
- **Unit tests** run the ingest package with `--maxWorkers` set to `--jobs`, then the other
  packages (only Jest accepts that flag).
- **Manifests** need `kustomize` and `kubeconform` on the PATH (`brew install kustomize kubeconform`).
  Without them the step is reported as `SKIP`, never as a pass, and the summary says so.
- **Images** only build (`docker compose --profile demo build`), as in CI; nothing is started.

Turborepo's cache (`.turbo/`, git-ignored) makes a repeat run fast: unchanged lint, typecheck, test
and build steps say `cache hit`. GitHub's runner starts with no cache, so use `--fresh` for the last
run before a merge. The e2e step is the heavy one; run it on its own, like `pnpm e2e:ingest`.

**What a run leaves on your machine.** The throwaway PostgreSQL and Mosquitto containers and the
script's temporary log folder are always removed (the logs are kept after a failure). The images
are **kept** by default: `iot-telemetry-pipeline-ingest` and `-simulator` (about 600 MB together,
the same ones `pnpm docker:demo` uses, so the next build is fast), plus the `postgres:17-alpine`
and `eclipse-mosquitto:2.0.18` images that `pnpm docker:up` uses too. `--clean` removes the two
images the run built and `.turbo/cache`; it never touches PostgreSQL, Mosquitto or the containers
of `pnpm docker:up`. Older builds of the same images turn into dangling layers: `docker image prune`
removes them, and `docker builder prune` clears Docker's build cache.

### Switching GitHub's CI off and on

All three jobs of `ci.yml` carry `if: ${{ vars.CI_ENABLED != 'false' }}`. The repository variable
`CI_ENABLED` is the switch; unset means CI runs.

```bash
pnpm ci:off      # CI_ENABLED=false: every job of ci.yml is skipped
pnpm ci:on       # CI_ENABLED=true
pnpm ci:status
```

`scripts/ci-toggle.sh` sets the variable with the GitHub CLI (`brew install gh && gh auth login`)
or, without it, with the REST API and `GH_TOKEN` / `GITHUB_TOKEN` (a token that may edit Actions
variables). With neither it prints where to set it by hand: **Settings → Secrets and variables →
Actions → Variables → `CI_ENABLED`**.

- **The switch works only where the workflow file has the `if`.** A pull request runs the workflow
  as it is on its own branch, so a branch cut before that change must merge or rebase `main` first.
- **A skipped job counts as passed for a required status check**, so branch protection does not
  block a merge while CI is off. Run `pnpm ci:local` (at least `--skip-images`) before merging, and
  turn CI back on afterwards.
- **Only `ci.yml` is switched.** The two scheduled contract workflows (`occ-contract.yml`,
  `platform-aws-contract.yml`) keep running at their own times.
- For one push only, put `[skip ci]` in the commit message; no variable is involved.

### Tests

- **Unit** — `*.spec.ts` next to the code in `apps/ingest/src`; Vitest `*.test.ts` in the contract;
  `*.test.ts` run by `node --test` in the simulator.
- **End to end** — `apps/ingest/test/pipeline.e2e-spec.ts` boots the real application against a
  real PostgreSQL and a real Mosquitto, with a fake command center and identity provider. It covers
  schema and partitions, storage and duplicates, rejections by reason, alert open → deliver → clear
  → resolve, sequence gaps, the read API, and draining the buffer on shutdown. It uses two MQTT
  connections in one shared group, and flushes and ticks the outbox explicitly.

The e2e suite recreates the `public` schema of its database on every run, so it is guarded
([V1-T03](tasks/v1/V1-T03-e2e-wipes-database.md)). It reads `TEST_DATABASE_URL` (default
`postgres://postgres:postgres@localhost:5432/telemetry_test`) and **never** `DATABASE_URL`, and it
aborts before connecting unless the database name ends in `_test`; once connected it checks
`current_database()` again before the first `DROP`. `pnpm e2e:ingest` points it at `telemetry_test`
inside the Compose PostgreSQL, and CI sets the variable for its service container.

The e2e run is heavier than unit tests (it starts a Nest application and two MQTT connections and
runs serially with `--runInBand`). Run it on its own, not alongside builds or watchers.

## Common changes

### Add a metric

1. Add it to `METRICS` in `packages/telemetry-contract/src/index.ts` with `unit`, `min` and `max`.
2. Add a case to `packages/telemetry-contract/src/index.test.ts`.
3. List it in the relevant devices in `apps/ingest/config/devices.json`.
4. Optionally add a rule in `rules.json` and a signal profile in
   `apps/simulator/src/signals.ts` (the simulator needs a baseline for each kind/metric it plays).
5. Update the metrics table in [telemetry-contract.md](telemetry-contract.md), and, on AWS, check
   nothing in platform-aws depends on the metric list.

No migration is needed: readings store `metric` as text.

### Add a device or a zone

See [onboarding a device](telemetry-contract.md#7-onboarding-a-device). A new zone code must exist in
ops-command-center before alerts for it can be delivered.

### Add or change a rule

Edit `apps/ingest/config/rules.json` ([field reference](configuration.md#rulesjson)). Startup
validation rejects a rule for an unknown kind or metric, a duplicate id, or a `clear` on the wrong
side of `raise`. Add a unit case in `rules-engine.spec.ts` if the behaviour (not only the numbers)
changes. Rule ids are stored on alerts, so renaming a rule orphans its open alerts' rule lookup —
prefer adding a new rule and retiring the old one.

### Add a migration

1. Create `apps/ingest/src/database/migrations/NNN_description.sql` with the next number. Files run
   once each, in name order, under an advisory lock.
2. Never edit an applied migration; add a new one. There are no down-migrations.
3. Remember `reading` is range-partitioned by day: indexes and constraints on it must work for
   partitioned tables, and creating partitions is the maintenance job's responsibility, not the
   migration's.
4. The e2e suite recreates the schema from scratch on every run, which exercises your migration.

### Add an alert destination

Implement `AlertSink` (`opened` returns an external reference, `cleared` receives it), choose it in
the factory in `app.module.ts`, and keep the outbox semantics: at-least-once, idempotent where the
destination allows, throw `RetryLater` when the failure is "not yet" rather than "broken". The
delivery worker, backoff and metrics need no change. Record the decision in a new ADR.

### Add an endpoint or a metric

Controllers live next to their feature module and are registered in `AppModule`. Use DTOs with
`class-validator` decorators — the global `ValidationPipe` is strict (`whitelist`,
`forbidNonWhitelisted`). New Prometheus metrics go in `metrics.ts`; keep label values to small
fixed sets and never label by device id. Update [api.md](api.md) or [operations.md](operations.md).

## Working across the three repositories

This repository, [ops-command-center](https://github.com/truongtankhanh/ops-command-center) and
[platform-aws](https://github.com/truongtankhanh/platform-aws) form one platform
([system-context.md](system-context.md)), but **each one builds and tests on its own**. No test in any
of them needs another repository running.

| Repository             | Run locally                                                                                           | Test                                                                     | Needs another repo? |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------- |
| iot-telemetry-pipeline | `pnpm docker:up`, then `pnpm --filter @itp/ingest dev`                                                | `pnpm test`, `pnpm test:e2e` (fake command center and identity provider) | No                  |
| ops-command-center     | `docker compose up --build` (console and Keycloak on `:18080`), or Postgres + Keycloak and `pnpm dev` | `pnpm test`, `pnpm test:e2e` (database name must end in `_test`)         | No                  |
| platform-aws           | Not runnable locally                                                                                  | `npm test`, `npm run synth` (template assertions)                        | No                  |

The stacks use different host ports (pipeline: 3100, 5433, 1883; command center: 18080, 15432, 13000),
so they can coexist, but starting both full stacks at once is heavy. Run them one after the other,
and run the test suites on their own.

### Which checks for which change

| You changed…                                                                | Run, in order                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline logic (rules, batch writer, parser, delivery internals)            | `pnpm test` here; add `pnpm test:e2e` if it touches the end-to-end path                                                                                                                                       |
| `telemetry-contract` or `devices.json`                                      | Tests here, then the platform-aws values below (topic filter, share group, thing attribute `zone`)                                                                                                            |
| How the pipeline calls the command center (incident payload, auth, key)     | Tests here (the contract test checks the calls against the command center's OpenAPI), then the **manual integration check** below                                                                             |
| The command center's incident API, roles or the `telemetry-pipeline` client | Its own tests; here `scripts/sync-occ-openapi.sh` and `pnpm test:ingest` to see the contract test react; then the manual integration check. The e2e suite uses a fake command center, so it cannot catch this |
| Environment variables, IoT policy or secrets in platform-aws                | `npm test` and `npm run synth` there; compare with [the values that must agree](system-context.md#3-values-that-must-agree-across-repositories)                                                               |

### Manual integration check: pipeline and command center

Run these steps one after another. They exercise what the automated suites cannot: the real command
center API, its Keycloak and the pipeline's client credentials.

1. **Command center:** in its repository run `docker compose up --build`, and wait until the console
   and Keycloak answer on `http://localhost:18080`.
2. **Pipeline infrastructure:** here, `pnpm docker:up`.
3. **Ingest on the host**, not in a container, so the token's issuer is the same `localhost:18080` the
   command center expects. In `apps/ingest/.env`, uncomment the four `OCC_*` variables and set
   `OCC_CLIENT_SECRET` to the `telemetry-pipeline` client's secret from the `occ` realm in
   Keycloak, then:

   ```bash
   pnpm --filter @itp/ingest start
   ```

   The log should say `Alert sink: ops-command-center`.

4. **Traffic:** `pnpm --filter @itp/simulator start -- --scenario server-room-overheat`.
5. **Expect:** about 25 seconds after the simulator starts, an incident "Server room temperature
   high" appears in the console, reported by `service-account-telemetry-pipeline`; about a minute
   later it is resolved without anyone touching it. `GET /api/alerts` shows a `deliveryStatus` of
   `delivered` and an `externalRef`.

If step 5 does not happen, `deliveryError` in `GET /api/alerts` and the table in
[operations.md](operations.md#alert-delivery-the-outbox) name the usual causes (`invalid_client`,
a zone code unknown to the command center, a role that cannot resolve the incident type).

### Pipeline and platform-aws

platform-aws is never run against this repository. The contract between them is a set of values
that exist in both places. A parity test checks most of them
([ADR-0010](adr/0010-parity-test-against-platform-aws.md)): the topic filter, share group, client id
prefix, port and health route, Keycloak client id, the environment variables platform-aws sets, and the
metric names and labels its CloudWatch selectors read. It reads a snapshot of platform-aws's telemetry
stack in `apps/ingest/test/contract`; refresh it with `scripts/sync-platform-aws.sh` after a change
there, and a daily workflow tests platform-aws's current `main`. Still checked only by people: the
image name and tag. Open the matching construct in platform-aws and run its `npm test` when you change
any of them (see the table in [system-context.md](system-context.md#6-changing-things-safely)).

### Known gaps in this workflow

- **The contract with the command center is checked against its OpenAPI document, not against its
  behaviour.** ([V1-T06](tasks/v1/V1-T06-no-contract-test-with-command-center.md),
  [ADR-0009](adr/0009-contract-check-against-command-center-openapi.md).) The contract test catches
  paths, fields, enums and headers; the role of the `telemetry-pipeline` client, the 24 h idempotency
  window and Keycloak still rely on the manual check above. The snapshot in
  `apps/ingest/test/contract` is refreshed with `scripts/sync-occ-openapi.sh`, and a daily workflow
  tests the command center's current `main`.
- **platform-aws is checked by name, not by behaviour.** ([V1-T07](tasks/v1/V1-T07-aws-constants-not-tied-to-pipeline.md),
  [ADR-0010](adr/0010-parity-test-against-platform-aws.md).) The parity test compares the values both
  sides hard-code; whether AWS IoT Core accepts the policy or CloudWatch receives the metrics still
  needs a deployed environment, and the image name and tag are not compared.
- Both repositories' e2e suites refuse to run unless the database name ends in `_test`; keep it that
  way ([V1-T03](tasks/v1/V1-T03-e2e-wipes-database.md)).

## Conventions

- TypeScript strict; ESLint flat config (`eslint.config.mjs`) with Prettier. The ingest package also
  lints with type information (`no-floating-promises`, `no-misused-promises`), so its lint is slower
  than the other packages; a deliberate fire-and-forget call is written `void promise`. Running
  `pnpm --filter @itp/ingest lint` directly needs `@itp/telemetry-contract` built first (`pnpm lint`
  and CI build it through Turborepo).
- Comments explain _why_ (constraints, trade-offs, ADR references), not what the code says.
- Validate at the edge (env, config files, MQTT input) and fail loudly at startup rather than
  half-working later.
- Commit messages follow Conventional Commits with the ticket id when there is one, as in the
  history (`feat(ingest): … (ITP-19)`).
- Decisions with trade-offs get an ADR in `docs/adr/` (context, options, decision, consequences)
  and a row in the decisions table in [architecture.md](architecture.md#7-decisions).

## Troubleshooting a local setup

| Symptom                                         | Likely cause                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment configuration: …` at start | A variable is missing or malformed; the message lists all of them                                                               |
| `ECONNREFUSED` to PostgreSQL                    | The stack is not running (`pnpm docker:up`), or an app's `.env` does not exist yet (see Setup)                                  |
| `/api/ready` returns 503 with `broker: down`    | Mosquitto not running, or `MQTT_URL` wrong                                                                                      |
| Messages arrive but nothing is stored           | Check `telemetry_rejections_total` by reason: probably `unknown_device` or `zone_mismatch`                                      |
| Alerts open but never become incidents          | `OCC_API_URL` unset (outbox rows `skipped`), or see the error table in [operations.md](operations.md#alert-delivery-the-outbox) |
| Edits to the contract have no effect            | Rebuild the package: `pnpm --filter @itp/telemetry-contract build`                                                              |

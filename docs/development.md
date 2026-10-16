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

| You changed…                                                                | Run, in order                                                                                                                                   |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline logic (rules, batch writer, parser, delivery internals)            | `pnpm test` here; add `pnpm test:e2e` if it touches the end-to-end path                                                                         |
| `telemetry-contract` or `devices.json`                                      | Tests here, then the platform-aws values below (topic filter, share group, thing attribute `zone`)                                              |
| How the pipeline calls the command center (incident payload, auth, key)     | Tests here, then the **manual integration check** below                                                                                         |
| The command center's incident API, roles or the `telemetry-pipeline` client | Its own tests, then the manual integration check. The e2e suite here uses a fake command center, so it cannot catch this                        |
| Environment variables, IoT policy or secrets in platform-aws                | `npm test` and `npm run synth` there; compare with [the values that must agree](system-context.md#3-values-that-must-agree-across-repositories) |

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
that exist in both places and are only checked by people: the topic filter, share group and client id
prefix, the image name and tag, the port and probe paths, and the metric names its CloudWatch
selectors read. When you change any of them here, open the matching construct in platform-aws and run
its `npm test` (see the table in [system-context.md](system-context.md#6-changing-things-safely)).

### Known gaps in this workflow

- **No automated contract test between the pipeline and the command center.** (Tracked as [V1-T06](tasks/v1/V1-T06-no-contract-test-with-command-center.md).) The fake command
  center in the e2e suite is written in this repository, so a change in the real API leaves both
  sides green. The manual check above is the safety net. Making the fake follow the command center's
  `docs/api/openapi.json` would close it cheaply.
- **No test ties platform-aws to this repository's constants.** (Tracked as [V1-T07](tasks/v1/V1-T07-aws-constants-not-tied-to-pipeline.md).) Keeping them equal relies on the
  table in [system-context.md](system-context.md#3-values-that-must-agree-across-repositories).
- Both repositories' e2e suites refuse to run unless the database name ends in `_test`; keep it that
  way ([V1-T03](tasks/v1/V1-T03-e2e-wipes-database.md)).

## Conventions

- TypeScript strict; ESLint flat config (`eslint.config.mjs`) with Prettier.
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

# @itp/ingest

The NestJS service at the centre of the pipeline: it consumes device telemetry from MQTT, validates
and stores it in PostgreSQL, rolls it up, evaluates alert rules and delivers alerts to
ops-command-center. Several replicas share one subscription (ADR-0001) and are stateless; all
durable state is in PostgreSQL. The architecture is in [docs/architecture.md](../../docs/architecture.md).

```
MQTT (shared subscription) → validate → batch writer → readings + rollups + sequence ledger
                                                     → rules → alert → outbox → ops-command-center
```

## Run it

From the repository root, once:

```bash
pnpm install
cp apps/ingest/.env.example apps/ingest/.env    # this app's settings
cp .env.example .env                            # shared Compose ports
pnpm docker:up                                  # PostgreSQL + Mosquitto (shared with the e2e suite)
```

Then:

```bash
pnpm --filter @itp/ingest dev                   # nest start --watch (long-lived: stop it when done)
pnpm --filter @itp/simulator start -- --scenario server-room-overheat   # some traffic
```

`start` runs the built service (`node dist/main.js`), so run `pnpm build` first. The HTTP API listens
on `PORT` (3100):

| Endpoint                            | Purpose                                        |
| ----------------------------------- | ---------------------------------------------- |
| `GET /api/devices`                  | Registered devices and when each was last seen |
| `GET /api/devices/:id/readings`     | Raw readings or per-minute rollups             |
| `GET /api/alerts`                   | Alerts and the state of their delivery         |
| `GET /api/health`, `GET /api/ready` | Liveness, readiness (database and broker)      |
| `GET /metrics`                      | Prometheus metrics (outside the `/api` prefix) |
| `/api/docs`                         | OpenAPI UI                                     |

## Configuration

Environment variables, validated at start (an invalid value stops the service with a list of what is
wrong). Locally they come from `apps/ingest/.env`, copied from [.env.example](.env.example); the
real environment wins over the file. Every variable is described in
[docs/configuration.md](../../docs/configuration.md), together with the formats of
[`config/devices.json`](config/devices.json) (the device registry) and
[`config/rules.json`](config/rules.json) (alert thresholds), which are reviewed as code and read at
boot.

## Scripts

Run from the repository root; the root scripts build the contract package first.

| Command                                                  | What it does                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm test:ingest`                                       | Unit tests (Jest, `src/**/*.spec.ts`)                                                             |
| `pnpm e2e:ingest`                                        | `pnpm docker:up`, then the e2e suite against the `telemetry_test` database                        |
| `pnpm --filter @itp/ingest lint` / `typecheck` / `build` | ESLint, `tsc --noEmit`, `nest build`                                                              |
| `pnpm bench:gaps` / `bench:gaps:loss`                    | Two-replica sequence-gap check ([benchmarks](../../docs/benchmarks.md#gap-count-across-replicas)) |

The e2e suite ([`test/pipeline.e2e-spec.ts`](test/pipeline.e2e-spec.ts)) boots the real application
against a real PostgreSQL and Mosquitto, with a fake command center and identity provider. It
**wipes the `public` schema** of `TEST_DATABASE_URL`, and refuses to run unless that database's name
ends in `_test`; it never reads `DATABASE_URL`. `pnpm e2e:ingest` gives it its own `telemetry_test`
([V1-T03](../../docs/tasks/v1/V1-T03-e2e-wipes-database.md)). It runs serially; run it on its own.

## Layout

```
src/
  telemetry/     mqtt-consumer, batch-writer, rollup, sequence-ledger, mqtt-options
  rules/         threshold rules with hysteresis (ADR-0004)
  delivery/      alert outbox worker and the ops-command-center sink (ADR-0005, ADR-0006)
  devices/       registry from devices.json, device API
  alerts/        alert API
  maintenance/   daily partitions and retention
  database/      pg pool and plain-SQL migrations (database/migrations)
  health/        liveness, readiness, /metrics
  config/        environment validation
config/          devices.json, rules.json
test/            e2e suite
```

More: [operations](../../docs/operations.md) (metrics, alerts, failure modes) ·
[telemetry contract](../../docs/telemetry-contract.md) · [API](../../docs/api.md) ·
[development guide](../../docs/development.md).

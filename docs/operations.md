# Operations

How to run, watch and troubleshoot the ingest service. Configuration is in
[configuration.md](configuration.md); the design behind the behaviours described here is in
[architecture.md](architecture.md) and the [ADRs](adr/).

## What runs, and what holds state

| Component       | State                                                                               | Notes                                                                        |
| --------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Ingest replicas | In memory only: write buffer, rule streaks, sequence tracker, token and zone caches | Stateless in the sense that matters: any replica can be killed and replaced. |
| PostgreSQL      | **All durable state**: devices, readings, rollups, alerts, outbox                   | The only thing to back up.                                                   |
| Mosquitto       | None (`persistence false`)                                                          | Queued, unacknowledged messages are lost if it restarts.                     |
| AWS IoT Core    | Managed                                                                             | Clean sessions: a group with no member online drops QoS 1 messages.          |

One process does everything: consume, validate, batch-write, evaluate rules, deliver alerts,
maintain partitions, serve the API. There is no separate worker to deploy.

## Health and probes

| Probe     | Path          | Passes when                                      | Used for                               |
| --------- | ------------- | ------------------------------------------------ | -------------------------------------- |
| Liveness  | `/api/health` | The process is up and answering                  | Restart a hung container               |
| Startup   | `/api/health` | Same; allows up to 60 s (30 × 2 s) to boot       | Migrations and partition setup on boot |
| Readiness | `/api/ready`  | Database reachable **and** ≥ 1 broker connection | Take the pod out of the Service        |

Readiness does not stop a pod consuming from the broker: the MQTT subscription is independent of
Kubernetes' view of the pod. It protects the API's callers, not the data path.

## Metrics

Served at `/metrics` (Prometheus text). Label values are small fixed sets, never device ids, so
cardinality does not grow with the fleet. Default Node.js process metrics are included.

| Metric                             | Type      | Labels       | Meaning                                                                                    |
| ---------------------------------- | --------- | ------------ | ------------------------------------------------------------------------------------------ |
| `telemetry_messages_total`         | counter   | `result`     | MQTT messages received: `accepted` or `rejected`                                           |
| `telemetry_rejections_total`       | counter   | `reason`     | Rejections by reason ([list](telemetry-contract.md#6-rejections))                          |
| `telemetry_readings_total`         | counter   | `result`     | Readings written: `stored`, `duplicate` (already present), `failed` (batch dropped)        |
| `telemetry_sequence_gaps_total`    | counter   | —            | Messages missing per device sequence numbers — **approximate across replicas** (see below) |
| `telemetry_batch_size`             | histogram | —            | Readings per database flush                                                                |
| `telemetry_flush_duration_seconds` | histogram | —            | Time to write one batch, including rollups                                                 |
| `telemetry_ingest_lag_seconds`     | histogram | —            | Measurement time → stored. Includes device clock error and any device-side buffering       |
| `telemetry_buffered_readings`      | gauge     | —            | Readings waiting for the next flush                                                        |
| `alerts_transitions_total`         | counter   | `transition` | Alerts `opened` or `cleared`                                                               |
| `alert_deliveries_total`           | counter   | `result`     | Outbox attempts: `delivered`, `skipped`, `retry`, `failed`                                 |

### Suggested alerts

Not shipped as code yet ([ITP-12](roadmap.md)). Starting points, to tune per site:

| Condition (PromQL)                                                                                | Why it matters                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `increase(telemetry_readings_total{result="failed"}[5m]) > 0`                                     | A batch was **dropped** — database trouble. Data is lost                                         |
| `rate(telemetry_sequence_gaps_total[5m]) > 0`                                                     | Messages lost before or inside the service (meaningful with one replica)                         |
| `rate(telemetry_messages_total[5m]) == 0`                                                         | Nothing is arriving: broker, devices or subscription                                             |
| `histogram_quantile(0.99, sum by (le) (rate(telemetry_ingest_lag_seconds_bucket[5m]))) > 5`       | Ingest falling behind (or device clocks drifting)                                                |
| `histogram_quantile(0.99, sum by (le) (rate(telemetry_flush_duration_seconds_bucket[5m]))) > 0.5` | Database is slow; the buffer will grow                                                           |
| `telemetry_buffered_readings > 5000`                                                              | The buffer is growing faster than it drains (no backpressure yet)                                |
| `increase(alert_deliveries_total{result="failed"}[15m]) > 0`                                      | An alert gave up being delivered — needs a human                                                 |
| `rate(telemetry_rejections_total[5m]) > 0` by `reason`                                            | Misconfigured or unknown devices; `unknown_device` after onboarding means the registry is behind |

Throughput reference: ≈ 10 000 messages/s on one replica ([benchmarks](benchmarks.md)). For scale,
1 000 sensors reporting every 10 s is 100 messages/s.

## Logs

Standard NestJS logging to stdout. The lines worth knowing:

| Logger                 | Line                                                                                        | Means                          |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------ |
| `Bootstrap`            | `Ingest API on http://localhost:3100/api`                                                   | Started                        |
| `Database`             | `Applied migration 001_initial_schema.sql`                                                  | Migration ran                  |
| `DevicesService`       | `Registered N devices from …`                                                               | Registry loaded                |
| `RulesService`         | `Loaded N rules from …`; `<title> — <device> <metric>=<value>` (warn)                       | Rules loaded; an alert opened  |
| `MqttConsumer`         | `Connection i subscribed to $share/ingest/campus/+/+/telemetry`; `MQTT[i]: …` (warn)        | Subscribed; a connection error |
| `BatchWriter`          | `Flush of N readings failed: …` (error)                                                     | **A batch was dropped**        |
| `DeliveryWorker`       | `Alert sink: ops-command-center` (or `none`); `Delivery <id> (<event>) attempt n: …` (warn) | Which sink; a failed attempt   |
| `PartitionMaintenance` | `Partitions created: […] dropped: […]`                                                      | Daily partition rollover       |

## Deploys and shutdown

On `SIGTERM` the service stops consuming on every MQTT connection, flushes the write buffer, lets
the delivery worker finish its pass, then closes the database pool. Planned restarts and rolling
deploys therefore lose nothing ([ADR-0002](adr/0002-ack-on-receipt-with-bounded-loss.md)).

The grace period must cover that drain, and is set in each environment:

| Environment | Setting                         | Value |
| ----------- | ------------------------------- | ----- |
| Compose     | `stop_grace_period`             | 30 s  |
| Kubernetes  | `terminationGracePeriodSeconds` | 30 s  |
| AWS (ECS)   | `stopTimeout`                   | 30 s  |

Rolling deploys keep capacity: Kubernetes uses `maxUnavailable: 0`, ECS keeps 100 % healthy. This
matters on AWS IoT Core, where a shared-subscription group with no online member **drops** QoS 1
messages.

Migrations run at boot (`MIGRATE_ON_BOOT`), serialised by an advisory lock. They are forward-only
plain SQL files; there is no down-migration. Review a new migration as you would any schema change
on a live, partitioned table.

## Scaling

- **Add replicas.** They join the same shared subscription group; the broker spreads messages.
  Writes are idempotent, outbox claiming uses `SKIP LOCKED`, and partition maintenance and
  migrations take advisory locks, so replicas do not collide. The Kubernetes HPA targets 70 % CPU
  between 2 and 6 replicas.
- **Brokers that cap per connection** (AWS IoT Core, 100 messages/s): raise `MQTT_CONNECTIONS`.
  Capacity is replicas × connections × the cap.
- **The database is the next limit.** A flush averages ~93 ms for ~1 800 readings in the
  benchmark, so one PostgreSQL instance carries several replicas; tuning notes (`synchronous_commit`,
  WAL sizing) are listed as not yet measured in [benchmarks](benchmarks.md#not-measured-yet).
- Each replica opens a pool of up to 10 database connections; size `max_connections` for
  replicas × 10 plus other clients.

## Data lifecycle

| Data              | Kept                         | Mechanism                                                           |
| ----------------- | ---------------------------- | ------------------------------------------------------------------- |
| Raw readings      | `RETENTION_DAYS` (30)        | Daily partitions `reading_YYYYMMDD`; expired ones are `DROP TABLE`d |
| 1-minute rollups  | `RETENTION_DAYS`             | `DELETE` of old buckets by the same hourly job                      |
| Alerts and outbox | Forever                      | No retention job. Both are tiny compared with readings              |
| Device registry   | As long as the file lists it | Removing a device from `devices.json` leaves its row and history    |

Partitions for today ± 2 days are created at startup and then hourly, under an advisory lock, so
no external cron is needed. A message whose timestamp falls outside the existing partitions is
rejected (`too_old`, `future`) rather than failing the insert.

To inspect partitions:

```sql
SELECT c.relname FROM pg_inherits i
JOIN pg_class c ON c.oid = i.inhrelid
JOIN pg_class p ON p.oid = i.inhparent
WHERE p.relname = 'reading' ORDER BY 1;
```

## Alert delivery (the outbox)

Each alert event (`opened`, `cleared`) is a row in `alert_delivery`, written in the same
transaction as the alert ([ADR-0005](adr/0005-alert-outbox.md)). The worker polls every
`DELIVERY_INTERVAL_MS`, claims up to 20 due rows with `FOR UPDATE SKIP LOCKED`, and calls the
command center.

| Status      | Meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| `pending`   | Waiting for its first attempt or a retry (`next_attempt`)         |
| `delivered` | Done                                                              |
| `skipped`   | No command center configured (`OCC_API_URL` unset); recorded only |
| `failed`    | Gave up after **12 attempts**; **never retried automatically**    |

Backoff is exponential with jitter: about 2 s, 4 s, 8 s … capped at 10 min. A row therefore gives
up after roughly **18–37 minutes** of continuous failure. A `cleared` event waits (as a retry) until
its `opened` event has produced an incident id.

```sql
-- How is delivery doing?
SELECT status, count(*), min(created_at) AS oldest FROM alert_delivery GROUP BY status;

-- Why is something stuck?
SELECT id, alert_id, event, status, attempts, next_attempt, last_error
FROM alert_delivery WHERE status IN ('pending', 'failed') ORDER BY id;

-- After fixing the cause, requeue failed rows (opened and cleared of the same alerts together)
UPDATE alert_delivery SET status = 'pending', attempts = 0, next_attempt = now()
WHERE status = 'failed';
```

Requeueing is safe for incident creation: each alert sends `Idempotency-Key:
telemetry-alert-<id>`, which the command center remembers for 24 hours. Past 24 hours, check that
an incident was not already created before requeueing an `opened` row.

Common `last_error` values:

| Error                                              | Cause and fix                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `token request → 401 … invalid_client`             | Wrong or stale `OCC_CLIENT_SECRET` (e.g. regenerated in Keycloak). Update the secret, restart                                   |
| `POST /incidents → 401`                            | The token was refused twice (a fresh one was tried): wrong realm or issuer, or the client is disabled                           |
| `… → 403`                                          | The service account's role may not report or resolve this incident type (`technician` is limited to Facilities and Environment) |
| `zone <code> does not exist in ops-command-center` | The device's `zoneCode` has no zone there. Fix the zone or the registry                                                         |
| `incident not created yet`                         | Normal for a `cleared` event waiting on its `opened` event                                                                      |
| Connection / timeout errors (5 s timeout)          | Command center or Keycloak unreachable. Retried; no action unless it persists                                                   |

## Failure modes

| Situation                          | What happens                                                                                                     | What you see                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Rolling deploy / `SIGTERM`         | Consumption stops, buffer is flushed, then exit                                                                  | Nothing lost                                                                                                     |
| Process killed (OOM, node failure) | Up to one flush window (≤ 250 ms or 1 000 readings) of received readings is lost                                 | Possibly a gap                                                                                                   |
| **PostgreSQL unavailable**         | Each flush fails; its batch is **dropped** (not retried) while messages keep being acknowledged. Readiness fails | `telemetry_readings_total{result="failed"}`, `Flush … failed` logs, 503 on `/api/ready`. **Not** counted as gaps |
| Broker unavailable                 | Connections retry every 2 s and resubscribe on connect; readiness reports `broker: down` once all are down       | `/api/ready` 503; message rate drops to zero                                                                     |
| Broker drops messages (queue full) | QoS 1 messages above the broker's queue limit vanish silently                                                    | `telemetry_sequence_gaps_total` — see [benchmarks](benchmarks.md#what-the-gap-metric-caught)                     |
| Command center / Keycloak down     | Alerts are recorded; delivery retries with backoff                                                               | `alert_deliveries_total{result="retry"}`; `failed` after ~18–37 min                                              |
| Poison reading                     | Fails its batch (all readings in that flush are dropped) and is logged                                           | `result="failed"`, error log with the database message                                                           |
| Replica added/removed              | Devices move between replicas; rule streaks restart, open/closed alert state is rebuilt from the database        | At worst an alert opens a few readings later                                                                     |
| Duplicate delivery from the broker | Hits the primary key; counted, not stored twice, rollups unchanged                                               | `telemetry_readings_total{result="duplicate"}`                                                                   |

## Security posture

This system is a V1 demo and **not intended for production** (see the [README](../README.md#scope-v1-demo-only)).
The table records what is and is not protected today, and what hardening would involve if it were ever
promoted. Tracked as [V1-T04](tasks/v1/V1-T04-unauthenticated-api-metrics-docs.md).

| Area                     | Today                                                                                                           | If promoted beyond the demo                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Broker (Mosquitto)       | `allow_anonymous true`, plain port 1883 — **development only**                                                  | Password file or client certificates, TLS, and an ACL limiting each device to its own topic |
| HTTP API and `/metrics`  | No authentication                                                                                               | Keep on a private network; put an authenticating proxy in front if it must be reachable     |
| OpenAPI UI (`/api/docs`) | Always enabled                                                                                                  | Disable or restrict per environment (the command center does this in its ADR-0005)          |
| Command center auth      | OAuth 2.0 client credentials; token cached in memory, never logged                                              | Store `OCC_CLIENT_SECRET` in a secret store; rotate in Keycloak                             |
| Secrets in config        | Compose and the local Kubernetes overlay contain throwaway dev passwords                                        | Never reuse them; inject real values from Secrets Manager / a Kubernetes Secret             |
| Container                | Non-root user, read-only root filesystem, dropped capabilities (Kubernetes)                                     | Keep                                                                                        |
| Database                 | Password in `DATABASE_URL` in dev                                                                               | TLS (`sslmode=verify-full`) and a password from a secret, as on AWS                         |
| Input                    | Topic, payload shape, ranges, registry membership and timestamps validated before storage; SQL is parameterised | Keep                                                                                        |

## Known limitations

Recorded so nobody has to rediscover them. Each is a deliberate scope boundary or a pending
roadmap item, not an oversight in the docs. The ones that need work are tracked in
[docs/tasks/v1](tasks/v1/README.md): items 1 and 2 as
[V1-T01](tasks/v1/V1-T01-sequence-gap-metric-multi-replica.md) and
[V1-T02](tasks/v1/V1-T02-failed-flush-drops-batch.md).

1. **`telemetry_sequence_gaps_total` over-counts with more than one consumer.** The tracker is an
   in-memory map per process. A shared subscription delivers each message to one member, so each
   process sees only a share of every device's sequence numbers and counts the "missing" ones as
   gaps. Out-of-order arrival across several connections of one process does the same. It is exact
   with one replica and one connection, which is how the benchmark found a real broker loss. Treat
   it as approximate otherwise ([ADR-0001](adr/0001-mqtt-shared-subscriptions.md) notes this); an
   alert on "any gap" is only meaningful for a single consumer.
2. **A failed flush drops its batch.** The messages were already acknowledged, and retrying a
   batch forever would let one bad row block ingest. During a database outage data is lost, and
   the loss is visible only in `telemetry_readings_total{result="failed"}` and the logs, not as
   gaps.
3. **No backpressure.** The write buffer is unbounded; a slow database grows memory until the
   container limit (512 Mi in the manifests). Tracked as [ITP-11](roadmap.md).
4. **Rule streaks are per replica and in memory** ([ADR-0004](adr/0004-rules-with-hysteresis.md)).
5. **Configuration is read at boot.** Changes to `devices.json` or `rules.json` need a restart or a
   rolling deploy.
6. **`/api/devices/:id/readings` silently caps raw results at 5 000 points**, oldest first.
7. **Failed deliveries are final** until a human requeues them.
8. **Alerts and outbox rows are never deleted.**

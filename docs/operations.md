# Operations

How to run, watch and troubleshoot the ingest service. Configuration is in
[configuration.md](configuration.md); the design behind the behaviours described here is in
[architecture.md](architecture.md) and the [ADRs](adr/).

## What runs, and what holds state

| Component       | State                                                             | Notes                                                                        |
| --------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Ingest replicas | In memory only: write buffer, rule streaks, token and zone caches | Stateless in the sense that matters: any replica can be killed and replaced. |
| PostgreSQL      | **All durable state**: devices, readings, rollups, alerts, outbox | The only thing to back up.                                                   |
| Mosquitto       | None (`persistence false`)                                        | Queued, unacknowledged messages are lost if it restarts.                     |
| AWS IoT Core    | Managed                                                           | Clean sessions: a group with no member online drops QoS 1 messages.          |

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

`/api/ready` also reports `alertSink`. It does not affect readiness; `none` means no command center is
configured, so alerts are recorded and marked `skipped`, never delivered.

## Metrics

Served at `/metrics` (Prometheus text). Label values are small fixed sets, never device ids, so
cardinality does not grow with the fleet. Default Node.js process metrics are included.

| Metric                             | Type      | Labels       | Meaning                                                                                 |
| ---------------------------------- | --------- | ------------ | --------------------------------------------------------------------------------------- |
| `telemetry_messages_total`         | counter   | `result`     | MQTT messages received: `accepted` or `rejected`                                        |
| `telemetry_rejections_total`       | counter   | `reason`     | Rejections by reason ([list](telemetry-contract.md#6-rejections))                       |
| `telemetry_readings_total`         | counter   | `result`     | Readings written: `stored`, `duplicate` (already present), `failed` (dropped, lost)     |
| `telemetry_sequence_gaps_total`    | counter   | —            | Messages confirmed missing per device sequence numbers, across all replicas (see below) |
| `telemetry_batch_size`             | histogram | —            | Readings per database flush                                                             |
| `telemetry_flush_duration_seconds` | histogram | —            | Time to write one batch, including rollups                                              |
| `telemetry_ingest_lag_seconds`     | histogram | —            | Measurement time → stored. Includes device clock error and any device-side buffering    |
| `telemetry_buffered_readings`      | gauge     | —            | Readings waiting for the next flush (they pile up while flushes are retried)            |
| `telemetry_flush_retries_total`    | counter   | —            | Flushes that failed for a reason unrelated to the data and were kept for a retry        |
| `telemetry_consumption_paused`     | gauge     | —            | `1` while the write buffer is full and the consumer holds back acknowledgements         |
| `alerts_transitions_total`         | counter   | `transition` | Alerts `opened` or `cleared`                                                            |
| `alerts_evaluation_pending`        | gauge     | —            | Rule evaluations waiting for the database (retried on the next flush); `0` when none    |
| `alerts_evaluation_dropped_total`  | counter   | —            | Rule evaluations given up on: bad data, or the pending queue (10 000) was full          |
| `alerts_state_corrections_total`   | counter   | `direction`  | Cached alert state fixed from the `alert` table (`to_open`, `to_closed`); normally `0`  |
| `alert_deliveries_total`           | counter   | `result`     | Outbox attempts: `delivered`, `skipped`, `retry`, `failed`, `waiting`                   |

### Suggested alerts

Not shipped as code yet ([ITP-12](roadmap.md)). Starting points, to tune per site:

| Condition (PromQL)                                                                                | Why it matters                                                                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `increase(telemetry_readings_total{result="failed"}[5m]) > 0`                                     | Readings were **dropped** — rejected by the database, or given up on at shutdown. Data is lost   |
| `increase(telemetry_flush_retries_total[5m]) > 0`                                                 | The database is failing; writes are being retried and nothing is lost yet                        |
| `max_over_time(telemetry_consumption_paused[5m]) == 1`                                            | The buffer filled up: the broker is queueing. Data is at risk if the queue overflows             |
| `rate(telemetry_sequence_gaps_total[5m]) > 0`                                                     | Messages lost before or inside the service, including a dropped batch                            |
| `rate(telemetry_messages_total[5m]) == 0`                                                         | Nothing is arriving: broker, devices or subscription                                             |
| `histogram_quantile(0.99, sum by (le) (rate(telemetry_ingest_lag_seconds_bucket[5m]))) > 5`       | Ingest falling behind (or device clocks drifting)                                                |
| `histogram_quantile(0.99, sum by (le) (rate(telemetry_flush_duration_seconds_bucket[5m]))) > 0.5` | Database is slow; the buffer will grow                                                           |
| `telemetry_buffered_readings > 5000`                                                              | The buffer is growing faster than it drains (consumption pauses at `BUFFER_MAX_READINGS`)        |
| `increase(alert_deliveries_total{result="failed"}[15m]) > 0`                                      | An alert gave up being delivered — needs a human                                                 |
| `min_over_time(alerts_evaluation_pending[5m]) > 0`                                                | An alert transition waits on the database; the `alert` table does not show it yet                |
| `rate(telemetry_rejections_total[5m]) > 0` by `reason`                                            | Misconfigured or unknown devices; `unknown_device` after onboarding means the registry is behind |

Throughput reference: ≈ 10 000 messages/s on one replica ([benchmarks](benchmarks.md)). For scale,
1 000 sensors reporting every 10 s is 100 messages/s.

## Logs

Standard NestJS logging to stdout. The lines worth knowing:

| Logger                        | Line                                                                                                                                                                                   | Means                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Bootstrap`                   | `Ingest API on http://localhost:3100/api`                                                                                                                                              | Started                                                                           |
| `Database`                    | `Applied migration 001_initial_schema.sql`                                                                                                                                             | Migration ran                                                                     |
| `DevicesService`              | `Registered N devices from …`                                                                                                                                                          | Registry loaded                                                                   |
| `RulesService`                | `Loaded N rules from …`; `<title> — <device> <metric>=<value>` (warn)                                                                                                                  | Rules loaded; an alert opened                                                     |
| `MqttConsumer`                | `Connection i subscribed to $share/ingest/campus/+/+/telemetry`; `MQTT[i]: …` (warn)                                                                                                   | Subscribed; a connection error                                                    |
| `BatchWriter`                 | `Flush of N readings failed (attempt n), retrying in X ms: …` (warn)                                                                                                                   | Database trouble; kept, retried                                                   |
| `BatchWriter`                 | `Dropped N readings: …` (error)                                                                                                                                                        | **Readings were lost**                                                            |
| `RulesService`                | `Rule evaluation deferred, N pending: …` (warn)                                                                                                                                        | Alert transitions wait on the database; retried on the next flush and at shutdown |
| `RulesService`, `BatchWriter` | `Rule evaluation dropped, the database rejected it: …`; `Pending rule evaluations are full, dropped the oldest N`; `N rule evaluations still pending at shutdown, not applied` (error) | **Alert transitions were lost**                                                   |
| `DeliveryWorker`              | `Alert sink: none — alerts are recorded and marked skipped, never delivered. Set OCC_API_URL to deliver them.` (warn)                                                                  | **No command center configured: alerts are skipped**                              |
| `DeliveryWorker`              | `Alert sink: ops-command-center`; `Delivery <id> (<event>) attempt n: …` (warn)                                                                                                        | Which sink; a failed attempt                                                      |
| `PartitionMaintenance`        | `Partitions created: […] dropped: […]`                                                                                                                                                 | Daily partition rollover                                                          |

## Deploys and shutdown

On `SIGTERM` the service stops consuming on every MQTT connection, flushes the write buffer, lets
the delivery worker finish the row it is delivering (it takes no new one), then closes the database pool. Planned restarts and rolling
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
  Writes are idempotent, rollup rows are upserted in key order, outbox rows are leased,
  and partition maintenance and migrations take advisory locks, so replicas do not collide. The Kubernetes HPA targets 70 % CPU
  between 2 and 6 replicas.
- **Brokers that cap per connection** (AWS IoT Core, 100 messages/s): raise `MQTT_CONNECTIONS`.
  Capacity is replicas × connections × the cap.
- **The database is the next limit.** A flush averages ~93 ms for ~1 800 readings in the
  benchmark, so one PostgreSQL instance carries several replicas. `synchronous_commit` was
  measured and showed no gain beyond the noise; WAL sizing is not measured yet
  ([benchmarks](benchmarks.md#synchronous_commit)).
- Each replica opens a pool of up to `DB_POOL_MAX` database connections (10 by default); size
  `max_connections` for replicas × `DB_POOL_MAX` plus other clients. The connections are named
  `telemetry-ingest` in `pg_stat_activity`.
- **Statement timeout is off.** `DB_STATEMENT_TIMEOUT_MS` (0 by default, which sets nothing) cancels a
  statement that runs longer, with SQLSTATE `57014`. Set it on every replica at once. A cancelled flush is
  treated as a failure that says nothing about the rows: the batch stays in the buffer and is retried with
  backoff (`telemetry_flush_retries_total`), and a statement that is always too slow fills the buffer until
  consumption pauses (`telemetry_consumption_paused`); nothing is dropped. A cancelled API query answers
  HTTP 500. Migrations and the hourly partition maintenance exempt themselves, because they wait for an
  advisory lock and take locks that wait for readers.

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
`DELIVERY_INTERVAL_MS` and handles up to 20 due rows per pass, one at a time: it leases a row
(`alert_delivery.locked_until`, 60 s), calls the command center with no transaction open, and then
records the result. A replica that dies mid-call leaves its row leased; another replica takes it
when the lease ends, at most a minute later.

| Status      | Meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| `pending`   | Waiting for its first attempt or a retry (`next_attempt`)         |
| `delivered` | Done                                                              |
| `skipped`   | No command center configured (`OCC_API_URL` unset); recorded only |
| `failed`    | Gave up after **12 attempts**; **never retried automatically**    |

Backoff is exponential with jitter: about 2 s, 4 s, 8 s … capped at 10 min. A row therefore gives
up after roughly **18–37 minutes** of continuous failure. A `cleared` event waits, looking again
every 5 s and **without using an attempt**, until its `opened` event has produced an incident id. If
the `opened` event is settled without one (`failed` or `skipped`), the `cleared` event is settled the
same way at once, since there will be no incident to resolve.

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
| `incident not created yet`                         | Normal for a `cleared` event waiting on its `opened` event (`result="waiting"`, no attempt used)                                |
| Connection / timeout errors (5 s timeout)          | Command center or Keycloak unreachable. Retried; no action unless it persists                                                   |

## Failure modes

| Situation                          | What happens                                                                                                                                                                                                                                                            | What you see                                                                                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rolling deploy / `SIGTERM`         | Consumption stops, buffer is flushed, then exit                                                                                                                                                                                                                         | Nothing lost                                                                                                                                                                                                                                              |
| Process killed (OOM, node failure) | Up to one flush window (≤ 250 ms or 1 000 readings) of received readings is lost, and so are any pending (deferred) rule evaluations                                                                                                                                    | Possibly a gap                                                                                                                                                                                                                                            |
| **PostgreSQL unavailable**         | Flushes fail and are **retried** with backoff (250 ms – 5 s); the batch stays buffered. At `BUFFER_MAX_READINGS` the consumer stops acknowledging and the broker queues. Readiness fails. Alert transitions that cannot be written are deferred and applied on recovery | `telemetry_flush_retries_total`, `Flush … retrying` logs, `telemetry_consumption_paused`, 503 on `/api/ready`. `alerts_evaluation_pending`, `Rule evaluation deferred` logs. Lost only if the broker queue overflows (gaps) or the process dies meanwhile |
| Broker unavailable                 | Connections retry every 2 s and resubscribe on connect; readiness reports `broker: down` once all are down                                                                                                                                                              | `/api/ready` 503; message rate drops to zero                                                                                                                                                                                                              |
| Broker drops messages (queue full) | QoS 1 messages above the broker's queue limit vanish silently                                                                                                                                                                                                           | `telemetry_sequence_gaps_total` — see [benchmarks](benchmarks.md#what-the-gap-metric-caught)                                                                                                                                                              |
| Command center / Keycloak down     | Alerts are recorded; delivery retries with backoff                                                                                                                                                                                                                      | `alert_deliveries_total{result="retry"}`; `failed` after ~18–37 min                                                                                                                                                                                       |
| Poison reading                     | The batch is written in halves until the bad reading stands alone; only it is dropped and logged                                                                                                                                                                        | `result="failed"` (one per bad reading), `Dropped … readings` error log with the database message                                                                                                                                                         |
| Replica added/removed              | Devices move between replicas; rule streaks restart. Alert state is loaded from the database on first sight and compared with it every 30 s                                                                                                                             | At worst an alert opens a few readings later, or clears up to 30 s late; `alerts_state_corrections_total`                                                                                                                                                 |
| Duplicate delivery from the broker | Hits the primary key; counted, not stored twice, rollups unchanged                                                                                                                                                                                                      | `telemetry_readings_total{result="duplicate"}`                                                                                                                                                                                                            |

## Security posture

This system is a V1 demo and **not intended for production** (see the [README](../README.md#scope-v1-demo-only)).
The table records what is and is not protected today, and what hardening would involve if it were ever
promoted. Tracked as [V1-T04](tasks/v1/V1-T04-unauthenticated-api-metrics-docs.md).

| Area                     | Today                                                                                                                                                                          | If promoted beyond the demo                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Broker (Mosquitto)       | `allow_anonymous true`, plain port 1883 — **development only**                                                                                                                 | Password file or client certificates, TLS, and an ACL limiting each device to its own topic                   |
| HTTP API and `/metrics`  | No authentication; protected by the network only (cluster-internal `Service`)                                                                                                  | Bearer tokens and a read role ([V2-T04](tasks/v2/V2-T04-service-to-service-auth.md)); keep `/metrics` private |
| OpenAPI UI (`/api/docs`) | Off unless `API_DOCS_ENABLED=true`; on in local development and the Compose demo, off in the Kubernetes base ([ADR-0008](adr/0008-api-docs-switch-and-network-only-access.md)) | Keep off; enable only where the network already restricts access                                              |
| Command center auth      | OAuth 2.0 client credentials; token cached in memory, never logged                                                                                                             | Store `OCC_CLIENT_SECRET` in a secret store; rotate in Keycloak                                               |
| Secrets in config        | Compose and the local Kubernetes overlay contain throwaway dev passwords                                                                                                       | Never reuse them; inject real values from Secrets Manager / a Kubernetes Secret                               |
| Container                | Non-root user, read-only root filesystem, dropped capabilities (Kubernetes)                                                                                                    | Keep                                                                                                          |
| Database                 | Password in `DATABASE_URL` in dev                                                                                                                                              | TLS (`sslmode=verify-full`) and a password from a secret, as on AWS                                           |
| Input                    | Topic, payload shape, ranges, registry membership and timestamps validated before storage; SQL is parameterised                                                                | Keep                                                                                                          |

## Known limitations

Recorded so nobody has to rediscover them. Each is a deliberate scope boundary or a pending
roadmap item, not an oversight in the docs. The ones that need work are tracked in
[docs/tasks/v1](tasks/v1/README.md): items 1 and 2 as
[V1-T01](tasks/v1/V1-T01-sequence-gap-metric-multi-replica.md) and
[V1-T02](tasks/v1/V1-T02-failed-flush-drops-batch.md).

1. **`telemetry_sequence_gaps_total` is confirmed late, and only when the device reports again.**
   Gaps are counted from a per-device ledger in PostgreSQL (`device.last_seq`, `device.seq_holes`),
   so the count is the same with any number of replicas and connections, and a message that arrives
   after its successor fills its gap instead of adding one. The price: a gap counts only after
   `SEQUENCE_GRACE_MS` (default 30 s) **and** at the device's next message, so a device that goes
   silent right after a loss shows it only when it comes back. Alert on silence separately
   (`last_seen`, or the message rate). A device that restarts its counter closes its open gaps as
   lost.
2. **A database outage is survived, not free.** A failed flush is kept and retried
   ([V1-T02](tasks/v1/V1-T02-failed-flush-drops-batch.md), [ADR-0002](adr/0002-ack-on-receipt-with-bounded-loss.md#amendment-2026-10-16-a-failing-database)).
   Readings are still lost if the process is killed while the backlog is held (up to
   `BUFFER_MAX_READINGS`, not one flush window), if the broker's queue overflows while consumption is
   paused (size `max_queued_messages` for the longest outage you expect), or if the database is still
   down at shutdown. Only data errors are dropped, and only the offending reading.
3. **Backpressure is per connection and coarse.** Consumption pauses at `BUFFER_MAX_READINGS` and resumes
   at half of it; each connection can hold one message past the ceiling. A failure that retries forever
   (a missing table) halts consumption instead of dropping data.
4. **Rule streaks are per replica and in memory** ([ADR-0004](adr/0004-rules-with-hysteresis.md)).
5. **Configuration is read at boot.** Changes to `devices.json` or `rules.json` need a restart or a
   rolling deploy.
6. **`/api/devices/:id/readings` silently caps raw results at 5 000 points**, oldest first.
7. **Failed deliveries are final** until a human requeues them.
8. **Alerts and outbox rows are never deleted.**

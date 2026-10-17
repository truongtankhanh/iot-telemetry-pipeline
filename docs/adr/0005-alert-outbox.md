# ADR-0005: Deliver alerts through a transactional outbox

- **Status:** Accepted; amended 2026-10-17 so a worker takes a lease instead of holding a transaction (see the amendment below)
- **Date:** 2026-10-01

## Context

When an alert opens, the command center must get an incident. Calling its API inside the
ingest path couples ingest latency to another service's availability, and a crash between
"alert saved" and "HTTP call made" silently loses the incident.

## Decision

- Opening or clearing an alert inserts an `alert_delivery` row **in the same transaction**.
- A delivery worker claims due rows with `SELECT … FOR UPDATE SKIP LOCKED`, calls the sink, and
  marks the row delivered — or schedules a retry with exponential backoff (capped), recording the
  last error.
- The sink is an interface. M1 ships `OpsCommandCenterSink`, which resolves the zone code to the
  command center's zone id and calls `POST /api/incidents`; when no sink is configured, rows are
  marked `skipped` so the outbox does not grow.

## Consequences

- Ingest never waits on the command center; an outage only delays incidents.
- Delivery is at least once. A retry after a timeout whose request actually succeeded can create
  a duplicate incident; the request carries the alert id in its description so duplicates are
  recognisable. An idempotency key on the command center's API would remove them (tracked on its
  roadmap).
- Several replicas can run the worker safely thanks to `SKIP LOCKED`.

## Amendment (2026-10-17): a lease, not a transaction held across the HTTP call

The decision above claims due rows with `SELECT … FOR UPDATE SKIP LOCKED` and calls the sink while that transaction stays
open. The sink gives each HTTP request a 5 s timeout and may need a token, a zone lookup and the `POST` for one row, so with
a slow command center one pass of up to 20 rows kept a transaction, 20 row locks and a pool connection for minutes. It also
kept the row lock on every `alert` row it had just updated (`external_ref`), so `RulesService.clear` of that alert waited for
the pass to end, and with it the flush that awaits the rules. Reproduced in the e2e suite with a command center that holds one
response for 3 s: the clear of an already delivered alert did not finish until the pass did.

**Options considered:** the same transaction with a shorter timeout (the lock still outlives the work, and the timeout would
have to be lower than the sink's); a lease taken for a whole batch (20 rows × 5 s outlasts any sensible lease when the command
center times out every call, and other replicas would take rows this worker still holds); a lease per row (chosen).

**Decision:**

- **A lease, taken one row at a time.** A worker takes the oldest due row nobody holds with one statement that sets
  `alert_delivery.locked_until` to now plus 60 s (a constant in `DeliveryWorker`, not a setting); `SKIP LOCKED` stays inside
  that statement. It then calls the sink with no transaction, row lock or pool connection held, and records the result in a
  short transaction. A pass handles up to 20 rows this way, and picks up a row created while it runs.
- **Late results change nothing.** Every update of the result requires `status = 'pending'`, so a worker whose lease ran out
  cannot overwrite the result of the one that took the row over.
- **The command center is told at least once, as before.** A worker that dies mid-call, or whose result cannot be recorded,
  leaves its row leased; another replica delivers it again when the lease ends, at most a minute later. `opened` carries an
  idempotency key and a repeated `cleared` is a 409, which is a success, so the repetition is harmless.
- **A `cleared` event waits without spending attempts.** When the incident of its `opened` event does not exist yet (that row
  is still pending, perhaps leased by another replica), the `cleared` row looks again every 5 s and keeps its `attempts`, which
  count only refusals by the command center (`alert_deliveries_total{result="waiting"}`). When the `opened` row has been
  settled without an incident (`failed`, `skipped`, or `delivered` with no reference), the `cleared` row is settled the same
  way at once instead of waiting for ever.
- **Shutdown stops taking rows.** `SIGTERM` lets the row in flight finish and be recorded, and takes no other: the grace
  period no longer depends on how many rows are due. Rows not taken carry no lease.

**Consequences:**

- A slow or silent command center no longer holds a database connection or row locks, nor holds up the flush through the rules.
- After a crash, rows that were being delivered wait up to 60 s before another replica takes them.
- The change is a nullable column (`003_alert_delivery_lease.sql`, forward-only). During a rolling deploy an old replica, which
  ignores the lease, may select a row a new replica has leased and not yet recorded; the command center then gets the same
  request twice, which the idempotency key makes harmless. The new claim skips rows an old replica's open transaction has
  locked.
- `failed` rows are still final until a person requeues them, and `skipped` rows are never retried.

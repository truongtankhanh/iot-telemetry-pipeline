# ADR-0005: Deliver alerts through a transactional outbox

- **Status:** Accepted
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

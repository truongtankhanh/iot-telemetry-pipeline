---
paths:
  - 'apps/ingest/src/**/*.ts'
---

# Ingest service rules

## Data path (do not reorder without reading the ADR)

- The consumer acknowledges a message on receipt and the batch writer flushes later
  ([ADR-0002](../../docs/adr/0002-ack-on-receipt-with-bounded-loss.md)). A failed flush is retried, never dropped,
  except for a data error: `BatchWriter` classifies errors with `isDataError`
  (`apps/ingest/src/database/errors.ts`) and writes a batch in halves until the bad reading stands alone.
- One flush is one transaction through `Database.transaction` (`database/database.ts`). Keep the first error
  when a `ROLLBACK` fails; do not let a second error replace it.
- Rules run after commit, on the rows actually inserted. A rule transition is persisted before the cached
  state moves, and a failed transition is kept for a retry ([ADR-0004](../../docs/adr/0004-rules-with-hysteresis.md)).
- Alerts reach the command center through the outbox, claimed with a lease, with the HTTP call outside any
  transaction ([ADR-0005](../../docs/adr/0005-alert-outbox.md)).
- Several replicas run at once: anything cached in memory (alert state, rule streaks, zone and token caches)
  must tolerate another replica changing the database.

## Style

- SQL goes through `pg` with bind parameters; there is no ORM. Never build SQL from a request value.
- Read configuration through the typed `ConfigService`; a new variable is added to `config/env.validation.ts`,
  `docs/configuration.md` and `apps/ingest/.env.example` in the same change, with its range and default.
- Log through Nest's `Logger`; the JSON format and the request and batch ids come from `logging/`. Never log a
  secret or a token.
- Metric names, types and labels live in `metrics/metrics.ts`. Labels are small fixed sets, never device ids.
  Renaming a metric breaks platform-aws and `deploy/observability/`.
- A deliberate fire-and-forget is `void promise` (typed lint rules are on).

## HTTP

- Controllers return the response classes of their `*.dto.ts`; after changing a route or DTO run
  `pnpm docs:openapi` and commit `docs/openapi.json`. Errors follow the shapes in `docs/api.md`.
- The API has no authentication in V1 (ADR-0008); do not add a half-measure.

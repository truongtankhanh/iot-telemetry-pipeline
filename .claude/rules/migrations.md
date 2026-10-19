---
paths:
  - 'apps/ingest/src/database/migrations/*.sql'
  - 'apps/ingest/src/database/database.ts'
---

# Migration rules

- Migrations are plain SQL files named `NNN_description.sql` (`001_initial_schema.sql`, `002_sequence_ledger.sql`,
  `003_alert_delivery_lease.sql`), applied in name order, once each, at boot by `Database.migrate` under an
  advisory lock. Never edit a migration that has been merged: add the next number.
- They are **forward-only**: there is no down-migration. To undo one, write the compensating migration.
- During a rolling deploy (`maxSurge: 1`) the old and the new version run against the same schema. A migration
  must leave the old version working: add nullable or defaulted columns, never drop or rename one in the same
  release that stops using it.
- Look at the lock a statement takes on `device`, `alert_delivery` or a partitioned table before adding it; a
  long `ALTER` blocks the writers of every replica.
- `DB_STATEMENT_TIMEOUT_MS` does not apply to migrations or partition maintenance; keep that exemption.
- The e2e suite applies migrations to a fresh `telemetry_test` schema, so a migration is exercised by `pnpm e2e:ingest`.

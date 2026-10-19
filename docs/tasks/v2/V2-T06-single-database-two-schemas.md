# V2-T06: One PostgreSQL database with a schema per system

- **Status:** On hold (starts after ops-command-center V2 is done)
- **Version:** V2
- **Type:** Infrastructure
- **Spans:** iot-telemetry-pipeline, ops-command-center, platform-aws
- **Decision:** [ADR-0007](../../adr/0007-pipeline-as-the-single-telemetry-source.md), decision 3

## Problem

The platform runs separate databases per system on one instance (`ops`, `keycloak`, `telemetry`;
platform-aws ADR-0002). The agreed direction is one database with a schema per system, so there is one
thing to connect to, back up and size, while the boundary between systems stays: **no shared tables,
separate roles, no service reads the other's schema**. The command center reads telemetry through the
pipeline's API and stream, never through SQL.

Keycloak keeps its own database; it is a third-party application with its own migrations, and is out
of scope here.

## Scope

1. **Pipeline schema.** All pipeline objects live in schema `telemetry`, created by the database
   bootstrap, owned by a `telemetry` role whose `search_path` is `telemetry`.
   - The migration runner creates `schema_migration` in the **default schema** today; it must live in
     `telemetry`.
   - Partition maintenance queries `pg_inherits` for a table named `reading` and runs
     `CREATE TABLE reading_YYYYMMDD PARTITION OF reading` unqualified; qualify them or rely on the role's
     `search_path`, and add a test with another schema present.
   - The e2e suite currently runs `DROP SCHEMA public CASCADE` (see [V1-T03](../v1/V1-T03-e2e-wipes-database.md));
     it must drop and recreate only `telemetry` in a database whose name ends in `_test`.
2. **Command center schema.** The command center moves to schema `ops` with its own role and
   migrations table (TypeORM `schema` and `migrationsTableName`), tracked in that repository.
3. **platform-aws bootstrap.** The custom resource that creates logins and databases creates schemas
   and roles instead; its isolation tests change from "one system cannot open another's database" to
   "one system's role cannot read or write the other's schema".
4. **Local development.** Each repository keeps its own PostgreSQL container for its own tests and
   demo. The single database applies to the Kubernetes overlay, the combined local stack (if any) and
   AWS. Decide whether a combined Compose file is worth adding.
5. **Connection settings.** `DATABASE_URL` for the pipeline stays one URL; add `DATABASE_SCHEMA` (default
   `telemetry`) and set `search_path` on the pool. Document it in
   [configuration.md](../../configuration.md).
6. **Sizing.** Readings arrive at tens of thousands per second at the extreme; they now share an
   instance and a database with the business data. Re-check pool sizes (the pipeline opens up to 10
   connections per replica), `max_connections`, and autovacuum on the partitioned `reading` table.

## Evidence

- Pipeline: [`database.ts`](../../../apps/ingest/src/database/database.ts) (migration runner), [`partition-maintenance.service.ts`](../../../apps/ingest/src/maintenance/partition-maintenance.service.ts), [`pipeline.e2e-spec.ts`](../../../apps/ingest/test/pipeline.e2e-spec.ts).
- platform-aws: `docs/adr/0002-one-instance-per-stage-one-database-per-system.md`, the database bootstrap Lambda and its tests, `databases: ['ops', 'keycloak', 'telemetry']` in `lib/config.ts`.

## Acceptance criteria

- The pipeline starts, migrates, partitions and passes its e2e suite inside schema `telemetry` of a
  database that also contains schema `ops`.
- A connection as the `telemetry` role cannot `SELECT` from `ops` tables, and the reverse; a test in
  platform-aws proves it.
- Dropping schema `telemetry` leaves `ops` untouched.
- A rollback path is written down: how to go back to separate databases (the ADR's fallback).

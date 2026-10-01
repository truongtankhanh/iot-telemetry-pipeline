# ADR-0003: Plain PostgreSQL — daily partitions and write-time rollups

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Readings are append-only, time-ordered and mostly queried by recent time range per device.
Dashboards want per-minute summaries. Old raw data must be dropped after a retention period.

## Options

1. **One plain table** — simple until it is large; deleting old rows is slow and bloats the table.
2. **PostgreSQL declarative range partitioning by day, plus a rollup table maintained at write
   time** — no extensions, retention is `DROP TABLE` on an old partition, summaries are a primary
   key lookup.
3. **TimescaleDB** — hypertables, continuous aggregates and compression out of the box; an
   extension many managed Postgres offerings do not provide.
4. **A dedicated TSDB** (InfluxDB, ClickHouse) — strong for analytics, a second database to run.

## Decision

Option 2.

- `reading` is partitioned by day on `ts`. A maintenance job keeps partitions created two days
  ahead and drops those older than `RETENTION_DAYS`.
- `rollup_1m` is updated in the **same transaction** as the insert, from the rows the insert
  actually returned (`RETURNING`), so duplicates never inflate counts.
- Bucketing for ad-hoc queries uses `date_bin()` (PostgreSQL 14+).

## Consequences

- Runs on any PostgreSQL 14+, including managed services without extensions.
- Writes cost one extra upsert per (device, metric, minute) present in the batch — small because
  a batch covers well under a minute.
- Out-of-order readings older than the current partitions are rejected and counted; late data
  beyond two days is not supported.
- When data volume calls for compression or many aggregate levels, TimescaleDB is a drop-in
  path: the `reading` table becomes a hypertable and `rollup_1m` a continuous aggregate; the
  service's queries stay the same.

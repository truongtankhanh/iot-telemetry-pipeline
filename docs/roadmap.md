# Roadmap

## M1 — Ingest to alert ✅

| #      | Ticket                                                                              |
| ------ | ----------------------------------------------------------------------------------- |
| ITP-1  | Monorepo tooling; shared `telemetry-contract` (topic layout, payload parser)        |
| ITP-2  | Schema: device registry, day-partitioned readings, 1-minute rollups, alerts, outbox |
| ITP-3  | MQTT 5 consumer on a shared subscription; validation with counted rejection reasons |
| ITP-4  | Batch writer: idempotent inserts, rollups from inserted rows, drain on shutdown     |
| ITP-5  | Partition maintenance and retention inside the service                              |
| ITP-6  | Rules engine with consecutive breaches and hysteresis; alert lifecycle              |
| ITP-7  | Outbox delivery to ops-command-center (create and resolve incidents)                |
| ITP-8  | Read API (devices, readings, rollups, alerts), health/readiness, Prometheus metrics |
| ITP-9  | Simulator with scripted anomalies; end-to-end benchmark                             |
| ITP-10 | Docker Compose, Kubernetes (kustomize) with probes, HPA, PDB; CI                    |

## M2 — Operate it

| #      | Ticket                                                                                |
| ------ | ------------------------------------------------------------------------------------- |
| ITP-11 | Backpressure: stop reading from the broker when the write buffer passes a ceiling     |
| ITP-12 | Grafana dashboard and alert rules (gaps, lag, flush time, outbox age) shipped as code |
| ITP-13 | Multi-replica benchmark on a real cluster                                             |
| ITP-14 | Idempotency key on incident creation (needs ops-command-center support)               |
| ITP-15 | Mark telemetry-raised incidents with their own source in ops-command-center           |

## M3 — Scale and history

| #      | Ticket                                                                                 |
| ------ | -------------------------------------------------------------------------------------- |
| ITP-16 | Optional TimescaleDB mode: hypertable + continuous aggregates + compression (ADR-0003) |
| ITP-17 | Device provisioning API with per-device MQTT credentials and ACLs                      |
| ITP-18 | Rules editor with versioned rule sets and a dry-run against recent data                |

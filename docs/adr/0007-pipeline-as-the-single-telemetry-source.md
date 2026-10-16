# ADR-0007: The pipeline becomes the platform's single telemetry source

- **Status:** Accepted as the working direction; **on hold**. Pipeline V2 starts after ops-command-center V2 is done, and the integration approach is to be researched first, so the decisions below may be revised. The plan is in the [V2 tasks](../tasks/v2/README.md).
- **Date:** 2026-10-16

## Context

The platform has two independent telemetry paths ([V1-T05](../tasks/v1/V1-T05-overlap-with-occ-telemetry.md)):

- This pipeline: device- and zone-centric, `campus/<zone>/<device>/telemetry`, stores readings, evaluates
  count-based rules and raises incidents over REST.
- ops-command-center: asset-centric (its ADR-0018, ADR-0019), subscribes to its own broker on
  `occ/<site>/asset/<code>/telemetry`, keeps the latest state in memory, evaluates its own rules,
  and pushes to consoles over Socket.IO. It has its own simulator (`telemetry-sim`).

Two rules engines, two topic schemes, two simulators and two sets of broker credentials are more than
a demo platform needs. On AWS the command center's MQTT client cannot reach AWS IoT Core
(platform-aws ADR-0003), so its telemetry is `mock` or `off` there.

Plan agreed on 2026-10-16 (sequenced after ops-command-center V2): pipeline **V2** grows to cover what the command center's telemetry does,
including its simulator; command center **V3** then drops MQTT and takes all telemetry from the
pipeline in real time. Before V3 is done, both paths coexist.

## Decisions

1. **Realtime goes pipeline → OCC API → consoles.** The OCC API subscribes to a stream (with a
   snapshot of the latest state) offered by the pipeline, authenticated with a service token.
   Consoles keep talking only to the OCC API, so the single public origin and the single OIDC model
   stay as they are. Consoles never connect to the pipeline.
2. **The command center owns the asset catalogue** (assets, telemetry points, site plan); the
   pipeline synchronises it and maps devices and metrics onto it. The pipeline's simulator plays
   the synchronised catalogue and replaces the command center's `telemetry-sim`.
3. **One PostgreSQL database with one schema per system** (`ops`, `telemetry`), each with its own
   role, instead of separate databases. No table is shared and no service reads the other's schema:
   the command center reads telemetry through the pipeline's API only.

## Options considered

| Decision        | Chosen                                    | Rejected                                                                                                                                                                                            |
| --------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realtime path   | OCC API subscribes to the pipeline        | Consoles connect to the pipeline: second origin, second auth model, CORS, a public service                                                                                                          |
| Catalogue owner | Command center, synchronised              | Pipeline owns it: moves the site plan and digital-twin data out of the system that renders them                                                                                                     |
| Database        | One database, two schemas, separate roles | Shared tables: two services migrating and writing the same tables, readings competing with business data. Status quo (separate databases): kept as the fallback if schema isolation proves too weak |

## Consequences

- One topic scheme, one rules engine, one place for broker credentials. The command center no longer
  needs MQTT, a broker or a client certificate; its AWS gap disappears with V3.
- The pipeline must grow a realtime stream. Shared subscriptions split a device's messages across
  ingest replicas, so no ingest replica has a complete latest state; the stream needs a fan-out stage
  that sees every stored reading ([V2-T03](../tasks/v2/V2-T03-realtime-stream-and-snapshot.md)).
- The pipeline's data model widens from four fixed metrics on devices to the command center's
  assets and points, including boolean points, and its rules gain seconds-based sustain
  ([V2-T01](../tasks/v2/V2-T01-asset-catalogue-sync.md), [V2-T02](../tasks/v2/V2-T02-rules-parity-and-evidence.md)).
- The command center's console reads a rule's reason from the note of an incident's first timeline
  entry (`motorTempC 92 > 85 for 60 s`). Incidents raised by the pipeline must keep producing
  that note.
- The pipeline's API and stream become service-to-service interfaces and need authentication
  ([V2-T04](../tasks/v2/V2-T04-service-to-service-auth.md)); [V1-T04](../tasks/v1/V1-T04-unauthenticated-api-metrics-docs.md)
  is absorbed into it.
- A schema-per-system database changes platform-aws (database bootstrap and its isolation tests) and
  both repositories' connection settings ([V2-T06](../tasks/v2/V2-T06-single-database-two-schemas.md)).
- [V1-T01](../tasks/v1/V1-T01-sequence-gap-metric-multi-replica.md) and
  [V1-T02](../tasks/v1/V1-T02-failed-flush-drops-batch.md) matter more once the pipeline is the only
  source, and are prerequisites for V2.
- Between V2 and V3 both telemetry paths run; V1-T05 closes only when the command center's V3 is done.

## Revisit when

The realtime volume or latency target cannot be met through the OCC API's fan-out, or isolation by
schema proves too weak for the platform (then separate databases return, as today).

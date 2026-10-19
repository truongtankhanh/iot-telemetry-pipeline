# V2-T01: Synchronise the asset and point catalogue from the command center

- **Status:** On hold (starts after ops-command-center V2 is done)
- **Version:** V2
- **Type:** Feature
- **Spans:** iot-telemetry-pipeline, ops-command-center
- **Depends on:** [ADR-0007](../../adr/0007-pipeline-as-the-single-telemetry-source.md)

## Problem

The command center describes equipment as an **asset catalogue** (its ADR-0018): an asset class owns
telemetry points (`key` in camelCase such as `motorTempC`, a `kind` of `number`, `boolean` or `enum`, a
valid `min`/`max`, an `expected_interval_s`, a headline rank), and an asset is an instance placed in a
zone. The pipeline knows only **devices** in `devices.json`, with four fixed metrics in the contract
(`temperature_c`, `humidity_pct`, `co2_ppm`, `power_kw`) stored as `double precision`.

For the pipeline to be the single telemetry source, it must accept every point the command center's
assets have, and know which asset a reading belongs to. The command center keeps ownership of the
catalogue (ADR-0007, decision 2).

## Scope

1. **Catalogue source and sync.** The pipeline obtains the catalogue from the command center
   (assets, classes, points, zones) at boot and refreshes it on a schedule or on a change signal.
   Sync is pull-only; the pipeline never writes the catalogue. A stale or unreachable command center
   must not stop ingestion: the last good catalogue is kept (persisted in the `telemetry` schema).
2. **Replace the fixed metric list.** `METRICS` in the contract becomes data driven by the catalogue.
   The contract package keeps the topic and payload shape and the generic validation; point rules
   (kind, range) come from the catalogue.
3. **Typed values.** Support `number`, `boolean` and `enum` points. Today `reading.value` is
   `double precision`; decide between typed columns, a value encoding (boolean as 0/1, enum as an
   index into the class's `enum_values`) or one table per kind. The rollups apply to `number` only.
4. **Device ↔ asset mapping.** Decide the identity: the simplest is device id = asset code (`CT-01`
   already matches the pipeline's segment pattern). Zone code comes from the asset's zone. A device
   in `devices.json` that is not in the catalogue, and the reverse, must be reported, not ignored.
5. **Presence.** The command center shows an asset as online or offline, from a retained `status`
   topic with the device's last will, and expects readings at `expected_interval_s`. The pipeline has
   no notion of presence. Add it (last-will status topic and/or staleness from the expected interval)
   and expose it in the snapshot (V2-T03).
6. **Per-reading validation.** The command center drops a single out-of-range reading and counts it;
   the pipeline rejects the whole message. Choose one behaviour and record it in the contract.
7. **Wire format.** The two systems use different payloads today:

   | Aspect  | Pipeline today                     | Command center today                              |
   | ------- | ---------------------------------- | ------------------------------------------------- |
   | Topic   | `campus/<zone>/<device>/telemetry` | `occ/<site>/asset/<code>/telemetry` (+ `/status`) |
   | Payload | `{ seq, ts, metrics }`             | `{ at, values }`                                  |
   | QoS     | 1                                  | 0 telemetry, 1 retained status                    |

   The pipeline's scheme prevails (ADR-0007). Extend it with the `status` topic and with boolean and
   enum values, keep `seq` for gap measurement, and write the result into
   [telemetry-contract.md](../../telemetry-contract.md).

## Evidence

- Pipeline: [`telemetry-contract`](../../../packages/telemetry-contract/src/index.ts), [`devices.service.ts`](../../../apps/ingest/src/devices/devices.service.ts), [`001_initial_schema.sql`](../../../apps/ingest/src/database/migrations/001_initial_schema.sql) (`reading.value double precision`).
- Command center: `docs/adr/0018-assets-and-telemetry-as-domain-data.md`, `docs/api/telemetry.md` (topics and payload), `docs/api/assets.md`, `ops/telemetry-sim/catalogue.json`.

## Acceptance criteria

- Starting the pipeline against a command center with its demo catalogue registers every asset and
  point without editing `devices.json` by hand.
- Readings for a boolean and an enum point are stored and returned by the read API.
- Stopping the command center leaves ingestion running on the last good catalogue, and the
  condition is visible as a metric.
- An asset that goes silent is reported offline after a configurable multiple of its
  `expected_interval_s`.
- The contract document describes the final topic, payload, QoS and rejection behaviour.

## Open questions

- Sync mechanism: HTTP pull of an assets endpoint (which may need a new read-only service endpoint
  in the command center) or an exported file. Prefer HTTP with the service token from V2-T04.
- Does `devices.json` disappear, or remain as an override for devices without an asset?

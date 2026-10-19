# V2-T05: The simulator replaces the command center's `telemetry-sim`

- **Status:** On hold (starts after ops-command-center V2 is done)
- **Version:** V2
- **Type:** Feature
- **Spans:** iot-telemetry-pipeline, ops-command-center
- **Depends on:** [V2-T01](V2-T01-asset-catalogue-sync.md)

## Problem

The platform has two simulators. The pipeline's plays six environmental devices from `devices.json`
with a few scripted anomalies. The command center's `ops/telemetry-sim` plays **every seeded asset as its
own MQTT device** (own account, last will, healthy waveforms per point) from `catalogue.json`, and its
mock source scripts two breaches for the demo. With the pipeline as the only telemetry source, only
one simulator should remain, and it must be able to feed the command center's whole demo campus.

## Scope

1. **Play the catalogue, not `devices.json`.** The simulator reads the synchronised catalogue (V2-T01),
   or a catalogue file with the same shape, and publishes every asset and point at its
   `expected_interval_s`, using the pipeline's final topic and payload.
2. **Waveforms.** Port the command center's healthy waveforms per point kind (numbers with noise and
   daily shape, booleans, enums), so the digital twin looks the same as before. Keep a deterministic
   mode (seeded) for tests.
3. **Presence.** Each simulated device sets its last will and publishes online/offline on its status
   topic; the simulator supports stopping one device to demonstrate "stale".
4. **Scenarios.** Keep the pipeline's `server-room-overheat` and `crowded-lecture`, and add the
   command center's: cooling tower `CT-01` `motorTempC` held past its limit, and leak sensor
   `LKS-B3` `leakDetected` true. A scenario breach must outlast the rule's `for_s` in readings the
   rules see.
5. **Accounts.** One account per device with publish rights only on its own topic, generated from the
   catalogue as the command center's demo does, so the broker ACL is exercised in the demo.
6. **Benchmark.** `bench.ts` plays the larger catalogue; update [benchmarks.md](../../benchmarks.md).
7. **Retire the old one.** The command center removes `telemetry-sim` and its `telemetry` Compose
   profile as part of its V3; until then both may run, against separate brokers.

## Evidence

- Pipeline: [`apps/simulator/src`](../../../apps/simulator/src/main.ts), [`signals.ts`](../../../apps/simulator/src/signals.ts).
- Command center: `ops/telemetry-sim` (`catalogue.json`, `waveform.ts`, `schedule.ts`), `apps/api/src/telemetry/mock-scenario.ts`, README section "Telemetry".

## Acceptance criteria

- `docker compose --profile demo up` here, with the command center running, makes the twin show every
  seeded asset live, with the same two demo breaches raising incidents.
- Stopping one simulated device marks that asset stale, then offline.
- The simulator no longer needs a hand-written device list.
- The development guide's manual integration check is updated to this flow.

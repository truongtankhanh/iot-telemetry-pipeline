# ADR-0001: Scale ingest horizontally with MQTT 5 shared subscriptions

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

One ingest instance subscribed to `campus/+/+/telemetry` receives every message. Running two
instances with plain subscriptions would deliver every message twice — double the work, and the
duplicate-key protection would hide it rather than prevent it.

## Options

1. **Single instance, scale vertically** — simplest; a ceiling and a single point of failure.
2. **Partition topics by hand** (instance A takes zones 1–5, B takes 6–10) — static, needs
   reconfiguring on every scale event.
3. **MQTT 5 shared subscriptions** (`$share/<group>/<filter>`) — the broker load-balances messages
   across all clients in the group.
4. **Bridge MQTT into Kafka** and use consumer groups — strong ordering and replay, but a second
   distributed system to run for a campus-sized load.

## Decision

Option 3. Every replica subscribes to `$share/ingest/campus/+/+/telemetry`. Mosquitto (2.x) and
EMQX both support it.

## Consequences

- Scaling is `kubectl scale` (or the HPA); no reconfiguration.
- A device's messages may land on different replicas, so **nothing may rely on per-device
  in-memory state being complete**. Writes are idempotent; the rules engine rebuilds state from
  the database on a cache miss (ADR-0004); sequence-gap tracking is approximate across replicas
  and documented as such.
- No replay: once acknowledged, a message is gone from the broker. If replay becomes a
  requirement (reprocessing history through new rules), revisit option 4.

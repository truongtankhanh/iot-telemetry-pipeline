# V2-T03: Realtime stream and snapshot for the command center

- **Status:** On hold (starts after ops-command-center V2 is done)
- **Version:** V2
- **Type:** Feature (the hardest V2 task)
- **Spans:** iot-telemetry-pipeline, ops-command-center
- **Depends on:** [V1-T01](../v1/V1-T01-sequence-gap-metric-multi-replica.md), [V1-T02](../v1/V1-T02-failed-flush-drops-batch.md), [V2-T01](V2-T01-asset-catalogue-sync.md), [V2-T04](V2-T04-service-to-service-auth.md)

## Problem

After the command center's V3 it has no MQTT; every reading it shows comes from the pipeline, with
the latency of a live digital twin. The pipeline today only offers a read-only REST API over stored
data.

The obstacle is structural. Ingest replicas share one MQTT subscription, so the broker splits a
device's messages between them: **no single ingest replica holds a device's complete latest state**,
and a stream served straight from one replica would be partial and would differ between replicas.

## What the command center needs (from its ADR-0019 and `docs/api/telemetry.md`)

- A **snapshot**: the latest value of every key of every asset with a reading, plus presence
  (`online`), and when each was received.
- A **live stream** of changes, latest-wins and best-effort: a slow consumer skips, the next message
  corrects. (The command center's consoles get an overview about once a second, and up to 10 Hz for the
  few assets they watch; that tiering stays in the command center, which knows its consoles.)
- Every command-center replica holds the state itself (its ADR-0019, option 3), so **every replica
  of the command center subscribes**. A restarted replica asks for a snapshot, then follows the stream.
- Short history for sparklines after a reload (about 15 minutes), which the pipeline's rollup/raw
  read API can already serve.

## Scope

1. **A fan-out stage that sees every stored reading.** Options, with the trade-offs the design must
   settle:

   | Option                                                                                                                   | Trade-off                                                                                                   |
   | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
   | Ingest replicas publish stored readings to an internal channel (e.g. Redis pub/sub or a stream) read by a stream service | Clean separation; adds a dependency to run and secure                                                       |
   | A stream service holds a second, non-shared MQTT subscription and receives everything                                    | No new dependency; on AWS IoT Core a connection delivers at most 100 messages/s, so it does not scale there |
   | The command center connects to every ingest replica and merges                                                           | No new dependency; needs replica discovery and merging logic in the command center                          |
   | PostgreSQL `LISTEN/NOTIFY`                                                                                               | The command center rejected it for this volume in its ADR-0019 (WAL and queue pressure)                     |

2. **Snapshot endpoint** and **stream endpoint** with an explicit, versioned contract: message
   shapes, ordering (per asset), resume (a cursor or "ask for a snapshot again"), heartbeats, and
   backpressure (latest wins, never queue unbounded).
3. **Transport.** One of WebSocket, Server-Sent Events or gRPC streaming. Choose by what the command
   center's API can consume most simply with a bearer token and automatic reconnect. SSE is the
   lightest if one-way is enough.
4. **Presence in the stream** (online/offline transitions) and a **source status** (the pipeline's
   connection to its broker), so a console can tell "no data" from "pipeline down".
5. **Measure it.** Add metrics for stream consumers, messages sent, drops due to slow consumers and
   end-to-end latency (device timestamp to stream send), and a benchmark to put in
   [benchmarks.md](../../benchmarks.md).

## Evidence

- Pipeline: [`mqtt-consumer.service.ts`](../../../apps/ingest/src/telemetry/mqtt-consumer.service.ts) (shared subscription), [`batch-writer.service.ts`](../../../apps/ingest/src/telemetry/batch-writer.service.ts) (the point where stored readings exist), [ADR-0001](../../adr/0001-mqtt-shared-subscriptions.md).
- Command center: `docs/adr/0019-telemetry-transport.md`, `docs/api/telemetry.md`, `apps/api/src/telemetry/telemetry.gateway.ts`, `telemetry-ingest.service.ts`.
- platform-aws: [ADR-0003](https://github.com/truongtankhanh/platform-aws/blob/main/docs/adr/0003-aws-iot-core-as-the-broker.md) (100 messages/s per connection).

## Acceptance criteria

- With two ingest replicas, a snapshot from either returns the same complete latest state.
- A reading published to the broker reaches a stream consumer within a target latency (set during
  design; the batch flush alone is up to 250 ms), measured and recorded.
- A consumer that stops reading does not grow pipeline memory without bound.
- A restarted consumer gets a snapshot and continues without a gap it cannot detect.
- The contract is documented in this repository and mirrored in the command center's V3 plan.

## Open questions

- Is the target latency for twin movement tighter than the 250 ms flush interval? If so, the stream
  may need to publish before the database commit, with the consistency trade-off that implies.
- Where does the 1 Hz / 10 Hz tiering live if the command center later has many consoles? (Default:
  command center.)

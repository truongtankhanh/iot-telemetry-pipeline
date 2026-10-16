# ADR-0002: Acknowledge on receipt; bound and measure the loss window

- **Status:** Accepted; amended 2026-10-16 for a failing database ([V1-T02](../tasks/v1/V1-T02-failed-flush-drops-batch.md), see the amendment below)
- **Date:** 2026-10-01

## Context

The ideal is to acknowledge a QoS 1 message only after its reading is committed, so a crash can
never lose data. In MQTT.js the acknowledgement hook (`customHandleAcks`) runs **sequentially per
connection**: the next message is not processed until the current one is acknowledged. Delaying
each acknowledgement until a batch commits would therefore put one message in each batch and cut
throughput by two to three orders of magnitude.

## Options

1. **Ack after commit, one message per transaction** — no loss, ~hundreds of messages/s.
2. **Ack after commit with many parallel connections** — adds connection management to buy back
   some throughput; still far below batching.
3. **Ack on receipt, batch writes, drain on shutdown** — high throughput; a hard crash can lose
   the current, uncommitted batch.
4. **Put a durable log in front** (Kafka, NATS JetStream) and commit offsets after writing —
   correct and fast, one more system to operate.

## Decision

Option 3, with the loss **bounded and measured**:

- The batch writer flushes every **250 ms or 1 000 readings**, whichever comes first, so the
  window is small and fixed.
- `SIGTERM` stops consuming, flushes the buffer and only then exits; Kubernetes'
  `terminationGracePeriodSeconds` covers it. Planned restarts and rolling deploys lose nothing.
- Devices include a monotonically increasing `seq`. The service exports
  `telemetry_sequence_gaps_total`, so any loss — in the network, the broker or here — shows up
  as a number, counted from a ledger in PostgreSQL so it holds across replicas.

## Consequences

- An OOM kill or node failure can drop up to one flush window of readings. For environmental
  telemetry sampled every few seconds this is acceptable and visible.
- If a site needs zero-loss (billing-grade metering), option 4 is the upgrade path; the parser,
  writer and rules engine do not change.

## Amendment (2026-10-16): a failing database

The decision above bounds the loss to one flush window **while the database accepts writes**. The first
version also dropped a batch whenever its flush failed, so during an outage every window was lost
while the consumer kept acknowledging: the loss was unbounded and the buffer unlimited
([V1-T02](../tasks/v1/V1-T02-failed-flush-drops-batch.md)). Acknowledging on receipt stays; what happens
after a failed flush changes.

**Options considered:** retry everything (a single bad row blocks ingest for good); drop everything
(the original: an outage loses all data); classify the error and treat the two cases differently
(chosen); pause the broker connection (needed in any case, otherwise a retry holds memory without limit).

**Decision:**

- **The error decides.** PostgreSQL SQLSTATE class 22 (data exception) and 23 (integrity constraint)
  mean the rows are at fault. Everything else — connection refused or reset, restart in progress,
  deadlock, timeout — says nothing about the rows.
- **Not the rows' fault: keep and retry.** The batch goes back to the front of the buffer and the next
  attempt waits for an exponential backoff with jitter (250 ms up to 5 s). Sequence numbers are written
  in the same transaction as the readings, so they are kept with them.
- **The rows' fault: isolate.** The batch is written in halves until the offending rows stand alone.
  Only those are dropped, counted in `telemetry_readings_total{result="failed"}` and logged; their
  neighbours are stored. The sequence numbers of the whole batch are recorded first, on their own.
- **Bounded memory.** When the readings held in memory (buffered or being written) reach
  `BUFFER_MAX_READINGS` (20 000), the consumer stops acknowledging messages (`handleMessage` is held),
  which stops that connection's deliveries until the buffer is back to half. The broker's queue absorbs
  the outage instead of the process (ITP-11). `telemetry_consumption_paused` shows it.
- **Shutdown does not wait.** On `SIGTERM` the buffer is written once, ignoring any backoff; what the
  database still refuses is counted as failed and logged, because the process is leaving.

**Consequences:**

- A database outage loses nothing in this process as long as it ends before the process dies, and the
  broker's queue (`max_queued_messages`) holds what arrives meanwhile. If that queue overflows, the
  loss happens at the broker and shows up as `telemetry_sequence_gaps_total`, as before.
- The remaining windows of loss in this process: a hard kill during an outage loses the whole backlog
  (up to `BUFFER_MAX_READINGS`, not one flush window), and a shutdown with the database down loses the
  buffer. Both are counted when they can be (`failed`), and visible as gaps otherwise.
- A failure that is not recognised as the rows' fault but will never succeed (a missing table, say)
  retries forever and, through the ceiling, halts consumption. It is visible in
  `telemetry_flush_retries_total` and `telemetry_consumption_paused`, and in the logs.
- Zero loss, including a hard kill, still needs option 4 above.

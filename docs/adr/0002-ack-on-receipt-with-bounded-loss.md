# ADR-0002: Acknowledge on receipt; bound and measure the loss window

- **Status:** Accepted
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
  as a number.

## Consequences

- An OOM kill or node failure can drop up to one flush window of readings. For environmental
  telemetry sampled every few seconds this is acceptable and visible.
- If a site needs zero-loss (billing-grade metering), option 4 is the upgrade path; the parser,
  writer and rules engine do not change.

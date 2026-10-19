# V1-T01: Sequence-gap metric over-counts with more than one consumer

- **Status:** Done
- **Version:** V1
- **Type:** Bug (metric accuracy)
- **Found in:** documentation review, 2026-10-16

## Problem

`telemetry_sequence_gaps_total` is meant to turn every lost message into a number. It counts a gap
when a device's `seq` jumps forward by more than one. The tracker is an in-memory map **per
process**, and a shared subscription delivers each message to **one** member of the group. With N
replicas, each one sees roughly 1/N of every device's sequence numbers and counts the missing ones
as gaps. Several MQTT connections inside one process can reorder a device's messages, which also
counts a gap when `seq` 7 arrives before 6.

The metric is exact only with one replica and one connection. That is the setup of the benchmark that
found a real broker loss, so the headline claim holds there and nowhere else.

## Evidence

- `sequence-tracker.ts` (removed by the fix; the logic now lives in [`sequence-ledger.ts`](../../../apps/ingest/src/telemetry/sequence-ledger.ts)): per-process `Map`, counted `seq - previous - 1`.
- [`mqtt-consumer.service.ts`](../../../apps/ingest/src/telemetry/mqtt-consumer.service.ts): one tracker shared by all connections of the process; `observe` runs before the future/too-old checks.
- [`metrics.ts`](../../../apps/ingest/src/metrics/metrics.ts): the metric's own help text says "approximate across replicas".
- [ADR-0001](../../adr/0001-mqtt-shared-subscriptions.md) documents the approximation; [ADR-0002](../../adr/0002-ack-on-receipt-with-bounded-loss.md) relies on the metric for completeness.
- The platform-aws `SequenceGaps` alarm fires on any increase (`> 0`) and production runs 2–6 ingest tasks with 4 connections each.

## Impact on the demo

Low with the default Compose stack (one replica, one connection). Misleading on the Kubernetes
overlay with more than one replica, or on AWS: the metric rises without any message being lost, and
the "completeness is measured" highlight in the README no longer applies.

## If this system were ever promoted

The alarm would raise false alerts, and operators would learn to ignore the one signal meant to
reveal real data loss.

## Options

1. **Count gaps in PostgreSQL.** Store `last_seq` per device (the column exists, unused) and compare
   inside the flush transaction, so every replica works from the same truth. Handle out-of-order
   arrival and device restarts the same way the tracker does today.
2. **Reconcile offline.** Persist `(device_id, seq)` or per-minute `min/max/count` of `seq` and
   compute missing messages with a query; alert on the query, not on a counter.
3. **Document and restrict.** Keep the counter, label it single-consumer only, and drop it from any
   multi-replica alarm. Cheapest; leaves the claim narrower.

## Resolution

Option 1, with one change: comparing `seq` with `last_seq` alone would still over-count, because two
replicas flush on their own clocks and B can commit seq 6 before A commits seq 5. So the ledger is
order-independent:

- Migration `002_sequence_ledger.sql` adds `device.seq_holes` (jsonb) and `device.seq_last_ts`;
  `last_seq` becomes the highest `seq` of the current run.
- A lower `seq` that fills no hole is a device restart only if its `ts` is newer than the message
  that carried `last_seq`; otherwise it is a redelivery. The earlier rule (a step back of more than
  1 000) mistook late messages for restarts as soon as a flush lagged by a few seconds behind a
  busy device, which the two-replica benchmark exposed (about 36 000 false gaps in 50 000 messages).
- A jump forward opens a hole (the range not seen yet). A late message fills it; a hole still open
  after `SEQUENCE_GRACE_MS` (default 30 s) is confirmed lost and added to
  `telemetry_sequence_gaps_total`, once.
- `BatchWriter` updates the ledger in the flush transaction, under `FOR NO KEY UPDATE` row locks in
  id order, so replicas working on the same device take turns. It folds in the existing `last_seen`
  update, which now takes the same locks in the same order.
- `MqttConsumer` hands every attributable `seq` to the writer, rejected messages included.
  `SequenceTracker` is replaced by the pure `applySequences` ([sequence-ledger.ts](../../../apps/ingest/src/telemetry/sequence-ledger.ts)).
- The metric keeps its name and meaning, so the platform-aws `SequenceGaps` alarm needs no change.
  It sees a gap `SEQUENCE_GRACE_MS` later; its alarm period should be longer than that.

Trade-offs: a gap counts only at the device's next message after the grace period; a device that
leaves more than `MAX_HOLES` (10 000) gaps open at once, which takes a burst of thousands of messages
per second, has its oldest gaps counted early (the first two-replica benchmark, with a limit of
1 000, counted 9 179 false gaps this way); flushes that
share devices serialise briefly on the device rows; a dropped batch now shows up as gaps ([V1-T02](V1-T02-failed-flush-drops-batch.md)).

Verified on 2026-10-16 with `pnpm bench:gaps` and `pnpm bench:gaps:loss` (two replicas, two
connections each, 50 000 messages; see [benchmarks](../../benchmarks.md#gap-count-across-replicas)),
plus the unit and e2e suites: no loss left the gap count at zero, and a lossy broker's 45 632 lost
messages were each counted once.

Follow-up, not done: a gap is confirmed only at the device's next message after the grace period, so
the metric (and the platform-aws alarm) lags a loss until then. A periodic sweep in each replica
would close open gaps without waiting for the device.

## Acceptance criteria

- With two replicas and no message lost, the gap measure stays at zero over a benchmark run.
- With a deliberately dropped message (e.g. Mosquitto's default queue limit), the gap measure
  accounts for it exactly once.
- The README highlight, [operations.md](../../operations.md#known-limitations) and
  [system-context.md](../../system-context.md#7-open-points-across-the-three-repositories) are updated to match.
- If the metric name or semantics change, the platform-aws alarm is changed in step.

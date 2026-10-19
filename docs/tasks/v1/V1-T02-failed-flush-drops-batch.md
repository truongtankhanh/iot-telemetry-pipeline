# V1-T02: A failed flush drops its batch, and the loss is not visible as gaps

- **Status:** Done
- **Version:** V1
- **Type:** Risk (data loss behaviour)
- **Found in:** documentation review, 2026-10-16

## Problem

Messages are acknowledged to the broker on receipt ([ADR-0002](../../adr/0002-ack-on-receipt-with-bounded-loss.md))
and held in an in-memory buffer. If a flush fails, `BatchWriter` increments
`telemetry_readings_total{result="failed"}`, logs an error and **discards the whole batch**. The
decision is deliberate (a poison row must not block ingest), but it has two consequences that the
existing ADR does not spell out:

1. During a PostgreSQL outage every batch is dropped for as long as it lasts, while the consumer keeps
   acknowledging messages. The loss is not bounded by the 250 ms window.
2. ~~The dropped messages were already counted by the sequence tracker, so the loss does not appear in
   `telemetry_sequence_gaps_total`.~~ Changed by [V1-T01](V1-T01-sequence-gap-metric-multi-replica.md):
   the sequence ledger is written in the flush transaction, so a dropped batch never reaches it and
   its messages are counted as gaps once the device reports again (after `SEQUENCE_GRACE_MS`). The
   loss is still not visible _immediately_, and a silent device shows nothing until it returns.

A second, related property: the buffer has no ceiling and nothing pauses the broker consumer
(backpressure is [ITP-11](../../roadmap.md)). A slow database grows memory until the container limit.

## Evidence

- [`batch-writer.service.ts`](../../../apps/ingest/src/telemetry/batch-writer.service.ts) `writeBuffer`: `catch` drops the batch.
- [`mqtt-consumer.service.ts`](../../../apps/ingest/src/telemetry/mqtt-consumer.service.ts): `observe` is called before the batch is written.
- [`health.controller.ts`](../../../apps/ingest/src/health/health.controller.ts): readiness fails when the database is down but does not stop consumption.
- [`ingest.yaml`](../../../deploy/k8s/base/ingest.yaml): 512 Mi memory limit.

## Impact on the demo

Low. A demo with a healthy local database does not hit this. A reader stopping PostgreSQL to "see
what happens" will see readings silently disappear and the gap metric stay flat.

## If this system were ever promoted

Any database restart or failover loses data without a completeness signal, which contradicts the
"data completeness is a number on a dashboard" principle in the architecture.

## Options

1. **Retry before dropping.** Keep the failed batch and retry with backoff while the buffer stays
   under a ceiling; drop (and count) only a batch that is rejected for a data reason.
2. **Distinguish error classes.** Connection or availability errors retry; constraint or type errors
   drop and log the offending rows.
3. **Pause consumption.** Combine with ITP-11: stop reading from the broker while the buffer is over
   the ceiling, so the broker's queue (not process memory) absorbs the outage.
4. **Make the loss visible.** At minimum, count dropped readings in a metric that the gap alarm also
   covers, and add `failed` to the suggested alerts (already listed in
   [operations.md](../../operations.md#suggested-alerts)).

## Resolution

Options 1 to 4 together, written into [ADR-0002](../../adr/0002-ack-on-receipt-with-bounded-loss.md#amendment-2026-10-16-a-failing-database):

- [`BatchWriter`](../../../apps/ingest/src/telemetry/batch-writer.service.ts) classifies a failed flush
  with [`isDataError`](../../../apps/ingest/src/database/errors.ts) (SQLSTATE class 22 or 23). Any other
  failure keeps the batch, with its sequence numbers, at the front of the buffer and retries after an
  exponential backoff with jitter (250 ms to 5 s). Shutdown writes once and counts what is refused.
- A data error makes the writer record the sequence numbers on their own, then write the readings in
  halves until the offending rows stand alone. Only those are dropped
  (`telemetry_readings_total{result="failed"}`), so one malformed row no longer takes its neighbours with it.
- `BUFFER_MAX_READINGS` (default 20 000) bounds memory. At the ceiling the consumer holds
  `handleMessage`, which stops that connection's acknowledgements and, through the socket, its
  deliveries, until the buffer is back to half. This is ITP-11.
- New metrics `telemetry_flush_retries_total` and `telemetry_consumption_paused`, with suggested
  alerts in [operations.md](../../operations.md#suggested-alerts).
- The pool now has a `connectionTimeoutMillis` (5 s) and an `error` listener. Without the listener a
  database restart emits an unhandled `error` from an idle connection and kills the process, so none
  of the above would have been reached.

Trade-offs: a hard kill during an outage loses the held backlog (up to `BUFFER_MAX_READINGS`, not one
flush window); the broker queue must be sized for the outage (`max_queued_messages`), and what
overflows it is counted as gaps; a failure that is never the data's fault and never ends (a missing
table) retries forever and halts consumption, visible in the two new metrics.

Verified on 2026-10-16: the unit tests in `batch-writer.spec.ts`, `errors.spec.ts` and
`pipeline-helpers.spec.ts` pass (22 tests). Then, with the demo stack (`pnpm docker:demo`), PostgreSQL
was stopped for 30 s and started again: `telemetry_flush_retries_total` rose to 11, while
`result="failed"` was never incremented, `telemetry_sequence_gaps_total` stayed at 0, the buffer drained
to 0 and the ingest process kept running.

Not verified live: the pause itself (`telemetry_consumption_paused` stayed 0 because the demo's rate
never filled a 20 000-reading buffer in 30 s). It is covered by the unit tests only; reproduce it by
starting ingest with a small `BUFFER_MAX_READINGS` (at least twice `FLUSH_MAX_READINGS`) during an outage.

## Acceptance criteria

- With PostgreSQL stopped for 30 s during a steady load and then restarted, either no readings are
  lost, or every lost reading is counted in a metric that has an alert.
- A single malformed row does not block the readings around it.
- Memory use stays bounded during the outage.
- [ADR-0002](../../adr/0002-ack-on-receipt-with-bounded-loss.md) is amended or superseded with the new behaviour.

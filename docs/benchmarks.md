# Benchmarks

End-to-end throughput: messages published to the broker until every reading is committed in
PostgreSQL — through the shared subscription, validation, batched inserts, per-minute rollups and
rule evaluation. Measured with [`apps/simulator/src/bench.ts`](../apps/simulator/src/bench.ts).

```bash
pnpm --filter @itp/simulator bench -- --messages 100000
```

## Setup

|          |                                                                                               |
| -------- | --------------------------------------------------------------------------------------------- |
| Machine  | 2 vCPU, shared by everything below (cloud VM)                                                 |
| Ingest   | 1 replica, Node 24.21, `FLUSH_INTERVAL_MS=250`, `FLUSH_MAX_READINGS=1000`                     |
| Broker   | Mosquitto 2.0.18 with [`deploy/mosquitto/mosquitto.conf`](../deploy/mosquitto/mosquitto.conf) |
| Database | PostgreSQL 16.13, default configuration, same machine                                         |
| Load     | 6 devices, 2 readings per message on average, QoS 1, publisher on the same machine            |

## Results

Three consecutive runs of 100 000 messages (200 001 readings):

| Run | End-to-end time | Messages/s | Readings/s | Readings stored   |
| --- | --------------- | ---------- | ---------- | ----------------- |
| 1   | 9.92 s          | 10 079     | 20 158     | 200 001 / 200 001 |
| 2   | 10.50 s         | 9 522      | 19 044     | 200 001 / 200 001 |
| 3   | 9.74 s          | 10 267     | 20 535     | 200 001 / 200 001 |

**≈ 10 000 messages/s, ≈ 20 000 readings/s on one replica**, with nothing lost and no duplicates.
During a 50 000-message run the writer flushed 56 batches averaging ~1 800 readings (the buffer
keeps filling while a flush is in progress) in ~93 ms each (`telemetry_batch_size`,
`telemetry_flush_duration_seconds`), so the database was not the bottleneck: the single MQTT
connection's message handling was. That is what shared subscriptions are for (ADR-0001) — add
replicas.

For scale: 1 000 sensors reporting every 10 seconds is 100 messages/s, about 1 % of one replica.

## What the gap metric caught

The first run used Mosquitto's **default** configuration. 50 000 messages were published; the
service stored 89 753 readings instead of 100 000 and reported:

```
telemetry_messages_total{result="accepted"} 44873
telemetry_sequence_gaps_total 5127
```

44 873 + 5 127 = 50 000 exactly. The broker's default `max_queued_messages 1000` had silently
discarded QoS 1 messages once the subscriber fell behind during the burst. Nothing logged an
error; the sequence-gap counter (ADR-0002) accounted for every missing message. Raising the queue
limit in `deploy/mosquitto/mosquitto.conf` removed the loss — runs above report zero new gaps.

Lesson kept in the config file: QoS 1 is only as reliable as the broker's queue limits, and
completeness has to be measured, not assumed. Alert on `rate(telemetry_sequence_gaps_total[5m]) > 0`.

## Not measured yet

- Multiple replicas against one broker (needs more cores than this machine has).
- Long-running soak with partition rollover and retention drops.
- PostgreSQL tuned for write throughput (`synchronous_commit`, WAL sizing).

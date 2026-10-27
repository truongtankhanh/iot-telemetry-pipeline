# Benchmarks

End-to-end throughput: messages published to the broker until every reading is committed in
PostgreSQL — through the shared subscription, validation, batched inserts, per-minute rollups and
rule evaluation. Measured with [`apps/simulator/src/bench.ts`](../apps/simulator/src/bench.ts).

```bash
pnpm --filter @itp/simulator bench --messages 100000
```

Studio's Analytics page runs the same loop (`apps/simulator/src/bench-run.ts`, in a child process of the control server); the method is unchanged, and Studio records no results here.

## Setup

_First measurement (before the improvement work). It was taken on another machine than the
[baseline below](#baseline-for-the-optimization-work), with PostgreSQL 16.13 where Compose, CI and
Kubernetes run 17 today, and it records neither the commit nor how the service was started. Its
figures are not comparable with the baseline._

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

> **Correction (2026-10-18).** The conclusion above is not supported by this run's own figures, nor
> by the [baseline](#baseline-for-the-optimization-work). 56 flushes of ~93 ms are ~5.2 s, which is
> about the whole of a 50 000-message run at 10 000 messages/s (5 s): the writer was flushing
> back to back. In the baseline, the sum of the flush times is 94 % to 95 % of the run in all six
> runs, while the service's main thread is busy about a quarter of the time. On that machine the
> limit is the serial flush to PostgreSQL, not the handling of messages. ADR-0001 is not
> affected: replicas are still how consumers are added. What changes is what limits one replica.

For scale: 1 000 sensors reporting every 10 seconds is 100 messages/s.

## Baseline for the optimization work

The figures that a later performance change is compared with (how to repeat them is at the end of this section).
Taken on 2026-10-18 with `main` at `ca25ec7` plus one uncommitted change to `deploy/bench/run-baseline.sh` (the
`docker stats` sampler; the service and the contract are the code of `ca25ec7`). One replica, one MQTT connection, the
service on the host and PostgreSQL and Mosquitto in Docker's VM.

|            |                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine    | Apple M3 Pro, 12 cores, 18 GiB, macOS (Darwin 25.6.0, arm64); Docker 28.3.2 with a VM of 2 CPUs and 3.8 GiB                                 |
| Versions   | Node v24.21.0, pnpm 10.28.0, PostgreSQL 17.11 (`postgres:17-alpine`), Mosquitto 2.0.18                                                      |
| PostgreSQL | Default configuration: `synchronous_commit on`, `shared_buffers 128MB`, `max_wal_size 1GB`, `wal_writer_delay 200ms`                        |
| Broker     | [`deploy/mosquitto/mosquitto.conf`](../deploy/mosquitto/mosquitto.conf): `max_queued_messages 200000`, `max_inflight_messages 100`          |
| Service    | `MQTT_CONNECTIONS=1`, `FLUSH_INTERVAL_MS=250`, `FLUSH_MAX_READINGS=1000`, every other setting at its default, started with `env -i`         |
| Load       | `bench.ts`: 6 devices, 2 readings per message on average, QoS 1, 500 in flight, on the host; tables emptied before each run                 |
| Command    | `bash deploy/bench/run-baseline.sh --runs 3 --messages 200000` (the baseline) and `… --messages 100000` (the size of the first measurement) |

### Runs

Three consecutive runs of 200 000 messages (400 000 readings). Every run stored every reading, with no retry and no sequence gap.

| Run    | End-to-end | Messages/s | Readings/s | Flushes | Readings per flush | Flush time (avg) | Time in flushes | Service CPU per second |
| ------ | ---------- | ---------- | ---------- | ------- | ------------------ | ---------------- | --------------- | ---------------------- |
| 1      | 8.33 s     | 23 999     | 47 998     | 55      | 7 273              | 143.7 ms         | 95 %            | 0.40                   |
| 2      | 8.15 s     | 24 554     | 49 107     | 54      | 7 407              | 141.2 ms         | 94 %            | 0.36                   |
| 3      | 7.53 s     | 26 563     | 53 126     | 64      | 6 250              | 111.1 ms         | 94 %            | 0.40                   |
| median |            | **24 554** |            |         |                    |                  |                 |                        |
| best   |            | **26 563** |            |         |                    |                  |                 |                        |

Run-to-run spread (best against worst): **9.7 %**. A later change has to reach a median above **26 563 messages/s** on this
setup to be called faster; a smaller gain is inside the noise.

Three consecutive runs of 100 000 messages (200 001 readings), for the size of the first measurement:

| Run    | End-to-end | Messages/s | Readings/s | Flushes | Readings per flush | Flush time (avg) | Time in flushes | Service CPU per second |
| ------ | ---------- | ---------- | ---------- | ------- | ------------------ | ---------------- | --------------- | ---------------------- |
| 1      | 4.26 s     | 23 477     | 46 954     | 31      | 6 452              | 129.9 ms         | 95 %            | 0.50                   |
| 2      | 3.87 s     | 25 832     | 51 664     | 33      | 6 061              | 110.8 ms         | 95 %            | 0.43                   |
| 3      | 3.96 s     | 25 269     | 50 538     | 33      | 6 061              | 112.3 ms         | 94 %            | 0.39                   |
| median |            | **25 269** |            |         |                    |                  |                 |                        |
| best   |            | **25 832** |            |         |                    |                  |                 |                        |

Spread: **9.1 %**. "Time in flushes" is flushes times the average of `telemetry_flush_duration_seconds` (the transaction only),
as a share of the run. "Service CPU per second" is the delta of `process_cpu_seconds_total` over the run's time.

### What is the busiest

- **The flush.** The flushes run back to back: their times add up to 94 % to 95 % of the run in all six runs. One flush is one
  transaction on one connection, so the writer cannot go faster than a flush lets it, and ~7 000 readings in ~140 ms is
  about 20 µs per reading, including the rollup upsert and the sequence ledger.
- **PostgreSQL.** The container averaged 85 %, 87 % and 86 % of one VM core during the three 200 000-message runs
  (peaks 98 % to 105 %), and 81 %, 63 % and 80 % during the 100 000-message runs; `docker stats` gives about one sample
  per second, so these are 4 to 7 samples per run.
- **Mosquitto** averaged 20 % to 30 % in the 200 000-message runs (peak 73 %), and was not the limit.
- **The service's main thread** is idle most of the time: its CPU profile is busy 23 % to 37 % of each second while a 200 000-message run lasts (busy 7.3 s of a 29 s window that includes the pauses between runs), and the process used 0.36 to 0.50 cores. Any
  work taken out of the message path frees a small part of that quarter, and while the flushes are back to back it cannot
  raise throughput.

So, on this machine, throughput is set by the serial flush, and PostgreSQL is close to a core's worth of work on it. What inside the flush costs the most is measured in [the next section](#where-one-flush-spends-its-time).

### Top frames of the service

The CPU profile of the service for the 200 000-message invocation, from 3 s to 32 s after the process started (the three runs
and the pauses between them; the boot is left out). Shares are of the **busy** time of the main thread, 7 344 ms in this
window, not of the wall time.

| #   | Function            | File:line                                              | Self ms | Self % |
| --- | ------------------- | ------------------------------------------------------ | ------- | ------ |
| 1   | writev              | (native)                                               | 801.8   | 10.9 % |
| 2   | parsePayload        | packages/telemetry-contract/dist/index.cjs:78          | 682.6   | 9.3 %  |
| 3   | (program)           |                                                        | 441.2   | 6.0 %  |
| 4   | (garbage collector) |                                                        | 366.5   | 5.0 %  |
| 5   | parseDate           | node_modules/postgres-date/index.js:8                  | 327.8   | 4.5 %  |
| 6   | handle              | apps/ingest/dist/telemetry/mqtt-consumer.service.js:75 | 297.5   | 4.1 %  |
| 7   | rollup              | apps/ingest/dist/telemetry/rollup.js:14                | 277.3   | 3.8 %  |
| 8   | utf8Slice           | (native)                                               | 266.1   | 3.6 %  |
| 9   | escapeElement       | node_modules/pg/lib/utils.js:14                        | 248.0   | 3.4 %  |
| 10  | prepareValue        | node_modules/pg/lib/utils.js:51                        | 156.1   | 2.1 %  |
| 11  | parseTimestamp      | packages/telemetry-contract/dist/index.cjs:59          | 143.8   | 2.0 %  |
| 12  | debug               | node_modules/debug/src/common.js:66                    | 141.2   | 1.9 %  |
| 13  | dateToString        | node_modules/pg/lib/utils.js:95                        | 139.5   | 1.9 %  |
| 14  | parseTopic          | packages/telemetry-contract/dist/index.cjs:69          | 133.5   | 1.8 %  |
| 15  | (anonymous)         | (native)                                               | 126.2   | 1.7 %  |

By origin: the service 19.0 %, native code with no url 19.0 %, the contract 13.1 %, `pg` 9.6 %, Node internals 8.6 %,
`(program)` 6.0 %, the garbage collector 5.0 %, `postgres-date` 4.5 %, mqtt 3.3 %, `debug` 3.2 %, mqtt-packet 2.9 %,
`prom-client` 2.5 %.

Candidates of the per-message path, each as self and inclusive share of the busy time (the 100 000-message profile, taken the same way for 3 s to 21 s,
agrees within a point):

| Function (file:function)                  | Self % | Inclusive % | 100 000 messages, inclusive |
| ----------------------------------------- | ------ | ----------- | --------------------------- |
| `mqtt-consumer.service.js:handle`         | 4.1 %  | 20.9 %      | 21.2 %                      |
| `parsePayload` (the contract)             | 9.3 %  | 12.3 %      | 11.6 %                      |
| `postgres-date` (the `RETURNING` rows)    | 4.5 %  | 5.0 %       |                             |
| `rollup.js:rollup`                        | 3.8 %  | 3.8 %       |                             |
| `batch-writer.service.js:commit`          | 0.6 %  | 2.4 %       |                             |
| `ConfigService` / `config.service.js:get` | 0.3 %  | 0.5 %       | 0.5 %                       |
| `partitions.js:acceptedWindow`            | 0.3 %  | 0.4 %       | 0.8 %                       |
| `Histogram` / `observe`                   | 0.1 %  | 0.1 %       | 0.1 %                       |

None of these per-message costs is worth changing on this setup, and they were left as they are. Reading `RETENTION_DAYS` and
computing the accepted window for each message is 0.5 % and 0.4 % of the busy time; the acknowledgement hook
(`client.handleMessage` with `waitForRoom`) is 0.03 % to 0.11 %, and the 4.5 % under its callback is sending the
acknowledgement itself, which any version has to do; the lag histogram, observed once per reading, is 0.1 %; and
parsing the timestamp a second time in `handle` is at most `parseTimestamp` (2.2 %, of which the format and calendar checks stay)
plus the self time of `handle` (4.1 %, of which the second parse is a part). These are shares of the busy time, which is a quarter
of the wall time, while the flushes already fill 94 % to 95 % of it: removing one of them entirely would free about 1 % of the wall
time or less and could not raise throughput, and the 9 % spread between runs would hide it.

The command that produced the first two blocks, and the `--match` table:

```bash
node apps/simulator/src/cpuprofile-top.ts deploy/bench/out/<run>/profile/*.cpuprofile --from 3 --to 32 --top 15 \
  --match ':parsePayload$' --match 'mqtt-consumer.service.js:handle$' --match 'ConfigService|config.service.js:get' \
  --match 'partitions.js:acceptedWindow' --match 'Histogram|:observe$' --match 'rollup.js:rollup$' \
  --match 'batch-writer.service.js:commit' --match 'postgres-date'
```

`--timeline` prints the busy share per second, which is how the window was chosen.

### What this baseline is not

- Not comparable with the first measurement (another machine, another PostgreSQL major version, an unrecorded commit).
- One replica, one connection, an empty database that grows by 400 000 rows per run, a broker and a database sharing the 2 CPUs
  of Docker's VM while the service and the publisher run outside it. Another machine will give other numbers; compare a change only with a
  baseline taken on the same machine with nothing else running.
- Not a limit of the service in general: on a different database or disk the flush costs something else.
- The `docker stats` figures are about one sample per second over runs of 4 to 8 s.
- Bursts are limited. A 500 000-message burst is not a valid run: the publisher finishes in about 5 s, the broker queue passes
  `max_queued_messages 200000` and drops messages (564 649 of 1 000 000 readings stored, 0 sequence gaps counted, because a hole
  is confirmed only by a later flush after `SEQUENCE_GRACE_MS`), and after ~390 000 messages `bench.ts` timestamps pass the
  five-minute clock-skew limit and are rejected as `future`. 100 000 and 200 000 messages completed every time.
  `run-baseline.sh` refuses more than 250 000.

### How to repeat this

```bash
pnpm --filter @itp/telemetry-contract build && pnpm --filter @itp/ingest build
bash deploy/bench/run-baseline.sh --runs 3 --messages 200000
```

It needs Docker and a free `:5434`, `:1884` and `:3101`, builds nothing itself, and writes its results to
`deploy/bench/out/<UTC timestamp>/` (ignored by git): `environment.txt`, one JSON line per run, the `/metrics` scrapes, the
`docker stats` samples, the service log and the profile. Run it alone, with nothing else open, on the same machine as the
figures you compare with, and check afterwards that `ps -axo pid,ppid,command | grep "docker stats"` prints nothing.
`--pg-setting name=value` changes a PostgreSQL setting for the run, `--connections` the MQTT connections, `--profiler prof`
uses V8's tick profiler instead.

## Where one flush spends its time

Taken on 2026-10-18 on the machine and the stack of the baseline above, with [`deploy/bench/explain-flush.sql`](../deploy/bench/explain-flush.sql)
against the bench database left running by `run-baseline.sh --keep` (PostgreSQL 17.11, defaults). It builds a batch like the
benchmark's (3 500 messages over the six devices, 10 ms apart: 7 001 readings and 24 rollup rows), derives the arrays of the
three statements of a flush the way the service does, and passes them as the application's parameters. Part A runs each
statement under `EXPLAIN (ANALYZE, BUFFERS, WAL)` in a transaction that is rolled back; Part B runs them plainly, timed by `psql` over the
container's socket, and commits. It was run twice on tables holding a finished 200 000-message run (about 400 000 readings) and twice
on emptied tables; the second run of each is the one read, with the first for comparison.

### In the database

One transaction of ~7 000 readings (tables loaded, second run, Part B):

| Statement                                                | Time    | Share of the transaction | What `EXPLAIN` shows                                                                                                  |
| -------------------------------------------------------- | ------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `BEGIN`                                                  | 0.04 ms | 0.1 %                    |                                                                                                                       |
| `INSERT INTO reading … ON CONFLICT DO NOTHING RETURNING` | 77.0 ms | **95.4 %**               | 64.4 ms = 51.0 ms insert + 12.9 ms foreign-key trigger (7 001 calls); 56 771 buffer hits; 21 095 WAL records, 1.86 MB |
| `INSERT INTO rollup_1m … ON CONFLICT DO UPDATE`          | 0.41 ms | 0.5 %                    | 24 rows, 0.33 ms; the foreign-key trigger costs 0.1 ms when the rows are new                                          |
| `SELECT … FROM device … FOR NO KEY UPDATE`               | 0.10 ms | 0.1 %                    | 6 rows, 0.03 ms                                                                                                       |
| `UPDATE device … FROM unnest(…)`                         | 0.22 ms | 0.3 %                    | 6 rows, 0.16 ms                                                                                                       |
| `COMMIT`                                                 | 2.9 ms  | 3.6 %                    | the WAL flush (`synchronous_commit on`)                                                                               |
| **Total**                                                | 80.7 ms |                          |                                                                                                                       |

All four runs (the second empty run starts with the 7 001 readings the first one committed):

| Tables before | `EXPLAIN` of the insert | of which the foreign key | `psql` insert | `psql` commit | `psql` whole transaction |
| ------------- | ----------------------- | ------------------------ | ------------- | ------------- | ------------------------ |
| loaded, 1st   | 83.1 ms                 | 14.6 ms                  | 79.7 ms       | 3.1 ms        | 83.6 ms                  |
| loaded, 2nd   | 64.4 ms                 | 12.9 ms                  | 77.0 ms       | 2.9 ms        | 80.7 ms                  |
| empty, 1st    | 56.5 ms                 | 13.4 ms                  | 69.3 ms       | 39.4 ms       | 109.6 ms                 |
| empty, 2nd    | 69.1 ms                 | 15.0 ms                  | 83.5 ms       | 1.4 ms        | 86.3 ms                  |

- **The insert of the readings is the flush.** It is 95 % of the transaction. The other three statements together take about
  0.7 ms, so there is nothing between statements to fold. Each `psql` figure is one execution, and `EXPLAIN` and `psql` differ by
  up to 15 ms on the same statement; the figures are good to a few ms, not to the decimal.
- **The foreign key from `reading` to `device` costs 12.9 to 15.0 ms per flush**, 18 % to 24 % of the insert's execution in
  `EXPLAIN` and about 2 µs per row, around a tenth of the flush time the service reports. The same constraint on `rollup_1m` costs
  0.1 ms for its 24 rows.
- **The rest of the insert is the heap and the primary key** `(device_id, metric, ts)`: 42 to 51 ms, about 8 buffer hits per row on
  loaded tables (6 on empty ones), 3 WAL records and 260 to 285 bytes of WAL per row.
- **`COMMIT` is 1.4 to 3.1 ms**, except 39 ms once: the first commit after a `TRUNCATE`.
- **A round trip from Node to PostgreSQL through the published port is 0.155 ms** (500 `SELECT 1` on one connection). Six round
  trips are about 0.9 ms, under 1 % of a flush.

### Against what the service measures

In the baseline runs a flush of 6 250 to 7 407 readings took 111 to 144 ms in the service's own histogram, 17.8 to 19.8 µs per
reading; in the database, alone, a transaction took 11.6 to 12.3 µs per reading (81 to 86 ms for 7 001, leaving out the 39 ms
commit). So PostgreSQL's execution is 59 % to 69 % of a flush, and the other 31 % to 41 %, 35 to 60 ms, is not in these
measurements. What the profile of the service can account for on its main thread is about 10 ms per flush (encoding the array
parameters, `prepareValue`, 3.5 ms; parsing the returned rows, 5.0 ms, of which dates 2.1 ms; `rollup()`, 1.6 ms; the ledger,
0.5 ms; from 173 flushes in the three 200 000-message runs). The remaining 25 to 50 ms is not explained: the rows and arrays
cross Docker's published port, and during a run PostgreSQL shares the VM's two CPUs with Mosquitto and may be doing checkpoints and
autovacuum, which this isolated replay does not; none of this was measured.

### What would, and would not, be worth changing

| Candidate                                                            | Most it could save per flush                                                      | Against the 9.7 % spread (roughly 11 to 16 ms) |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Roll up inside the insert statement (one statement instead of two)   | 0.155 ms (a round trip) + 1.6 ms (`rollup()` in Node) + 0.3 to 0.6 ms (statement) | about 2 ms: not enough                         |
| Return less from the insert (cheaper `RETURNING`)                    | 5.0 ms (parsing the rows, dates 2.1 ms)                                           | about 5 ms: not enough                         |
| Fold the ledger `SELECT` and `UPDATE`, or merge `BEGIN` into a query | 0.3 ms                                                                            | not enough                                     |

None of these is justified by the figures, and none was done. The costs that are large are not about the number of statements:
the insert into `reading` (heap, primary-key index, WAL) and the foreign key to `device`. Both belong to the schema, and
changing either is a decision about integrity and storage, not a folding of statements. A flush is also one transaction on one
connection by design, so the next lever the figures point at is more writers at once, which replicas already provide (and the baseline
of a single replica does not show).

### How to repeat this

```bash
bash deploy/bench/run-baseline.sh --runs 1 --messages 200000 --keep
pg() { docker compose -p itp-bench -f deploy/bench/docker-compose.replicas.yml exec -T postgres psql -U postgres -d telemetry "$@"; }
for i in 1 2; do pg < deploy/bench/explain-flush.sql > explain-loaded-$i.txt 2>&1; done
pg -c "TRUNCATE reading, rollup_1m"
for i in 1 2; do pg < deploy/bench/explain-flush.sql > explain-empty-$i.txt 2>&1; done
docker compose -p itp-bench -f deploy/bench/docker-compose.replicas.yml down -v --remove-orphans
```

The script writes about 7 000 readings into the bench database on each run: never aim it at a database worth keeping. The
round trip was measured with 500 `SELECT 1` on one `pg` connection to `localhost:5434`.

## `synchronous_commit`

With `synchronous_commit = off` PostgreSQL answers a `COMMIT` before its WAL record is on disk. That can only help where the WAL
flush at commit is a visible part of a transaction, and it costs durability: after a crash of **PostgreSQL** (not of the
service) the most recent commits can be lost, for a window the server sets (`wal_writer_delay`, 200 ms here, and up to about
three times that). It is a setting of the database or the session, so it would apply to every transaction on a connection,
the alert and outbox ones included, on top of the loss window of one flush that the service already accepts when it
acknowledges on receipt ([ADR-0002](adr/0002-ack-on-receipt-with-bounded-loss.md)). Nothing in the service sets it; the runs
below set it on the throwaway bench database only (`run-baseline.sh --pg-setting synchronous_commit=off`, an
`ALTER DATABASE` before the service starts), and it disappeared with the volume.

Measured on 2026-10-18, on the machine of the baseline, with the same command and nothing else running, three sets of three
200 000-message runs one after the other: the default, `off`, and the default again, so that the drift of the machine between
two sets is seen next to the effect of the setting. `main` at `ca25ec7` plus uncommitted changes that do not touch the write
path (a rule lookup by id, a unit spec, documents and the scripts). Every run stored every reading, with no retry and no sequence gap.

| Set | `synchronous_commit` | Run 1  | Run 2  | Run 3  | Median     | Best   | Spread | Mean flush time |
| --- | -------------------- | ------ | ------ | ------ | ---------- | ------ | ------ | --------------- |
| A   | `on` (default)       | 21 407 | 21 690 | 24 964 | **21 690** | 24 964 | 14.2 % | 149.4 ms        |
| B   | `off`                | 21 531 | 24 068 | 24 032 | **24 032** | 24 068 | 10.5 % | 144.4 ms        |
| C   | `on` (default)       | 20 625 | 23 896 | 27 623 | **23 896** | 27 623 | 25.3 % | 134.8 ms        |

Messages per second; "mean flush time" is the mean of the three runs' average `telemetry_flush_duration_seconds`.

- **No effect that stands out of the noise.** `off` has a median 10.8 % above the first default set, but the second default set
  is 10.2 % above the first one with nothing changed, and `off` is 0.6 % above it. The difference between the settings is smaller
  than the difference between two sets of the same setting, and smaller than the spread inside each set (10.5 % to 25.3 %).
- **The run's position matters more than the setting.** Run 1 is the slowest in every set (21 407, 21 531 and 20 625) and run 3
  the fastest in two of them; the machine warms up, or something else on it settles.
- **It agrees with the flush section.** `COMMIT` took 1.4 to 3.1 ms in a transaction of 80 ms ([above](#where-one-flush-spends-its-time)),
  so that is all that `off` could remove from a flush of 111 to 165 ms, 2 % to 3 %, under the noise.
- The figures of these three sets are lower than the baseline taken earlier the same day with the same command (median
  24 554, best 26 563). A comparison of two settings is only as good as the sets are alike, which is why a second default
  set was taken.

So on this machine `synchronous_commit = off` shows no gain that can be told from the noise, and it is not recommended: a
smaller loss window is worth more than a gain nobody measured. If a later measurement on a disk where fsync is slow shows a
gain, adopting it is a decision of its own (which transactions, what window on top of the loss window above, how it is
configured), not a line in a configuration file. WAL sizing (`max_wal_size`, `checkpoint_timeout`) was not measured.

## Database pool size

`DB_POOL_MAX` sets how many connections the service may hold open to PostgreSQL (10 by default, as before the setting
existed). The question was whether it is also a speed setting. Measured on 2026-10-18 on the machine of the baseline, after a
rebuild, in five sets of three 200 000-message runs one after the other: 10, 2, 20, 5 and 10 again, so that the drift of the
machine between two sets of the same value is seen beside any effect of the value. `main` at `ca25ec7` plus uncommitted
changes (the setting itself and the scripts). Every run stored every reading, with no retry and no sequence gap.

| Set | `DB_POOL_MAX` | Run 1  | Run 2  | Run 3  | Median     | Best   | Spread | Mean flush time | Connections held after a run |
| --- | ------------- | ------ | ------ | ------ | ---------- | ------ | ------ | --------------- | ---------------------------- |
| 1   | 10            | 20 662 | 23 498 | 22 126 | **22 126** | 23 498 | 12.1 % | 143.7 ms        | 2, idle                      |
| 2   | 2             | 22 713 | 23 041 | 27 908 | **23 041** | 27 908 | 18.6 % | 141.1 ms        | 2, idle                      |
| 3   | 20            | 23 002 | 23 494 | 22 646 | **23 002** | 23 494 | 3.6 %  | 143.8 ms        | 2, idle                      |
| 4   | 5             | 22 982 | 24 445 | 28 633 | **24 445** | 28 633 | 19.7 % | 127.4 ms        | 2, idle                      |
| 5   | 10            | 23 570 | 25 260 | 27 528 | **25 260** | 27 528 | 14.4 % | 135.8 ms        | 2, idle                      |

Messages per second. "Connections held" is read from `pg_stat_activity` about two seconds after each run, by the name the
service gives its connections (`telemetry-ingest`): idle connections are closed after ten seconds, so what is still open
is what the run created.

- **No effect that stands out of the noise.** The medians run from 22 126 to 25 260. The two sets of the same value, 10, are
  14.2 % apart, more than any two different values; a pool of 2 is in the middle (23 041). An earlier attempt on a build that
  ignored the setting, so five sets of identical code, gave medians from 22 573 to 24 856 (9.2 %).
- **The service never held more than two connections**, with a ceiling of 5, 10 or 20 alike (every one of the fifteen
  snapshots shows two, all idle). A flush is one transaction at a time and the rest of the work waits in the same chain, so
  the second connection is for everything else.
- **What this does not show.** The benchmark opens no alert and takes no API request, so the outbox worker and the API, which
  also need a connection, were idle, and partition maintenance runs once an hour. A pool of 2 ran the benchmark without a
  retry; that is not advice to size a pool at 2 for a service that also delivers alerts and answers queries.

So `DB_POOL_MAX` is a **connection budget** (replicas times this against the server's `max_connections`), not a way to
ingest faster, and the default of 10 is well above what this load uses.

## What the gap metric caught

_The date, commit and machine of this run were not recorded._

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

## Gap count across replicas

[`deploy/bench/run-gap-check.sh`](../deploy/bench/run-gap-check.sh) starts two ingest replicas (two
MQTT connections each) on one broker and one database, publishes a burst, and accounts for every
message: accepted + gaps confirmed + gaps still open + messages lost at the end of a device's run
must equal what was published ([V1-T01](tasks/v1/V1-T01-sequence-gap-metric-multi-replica.md)).

```bash
pnpm bench:gaps        # no loss: the gap count must stay at 0
pnpm bench:gaps:loss   # lossy broker: every lost message counted exactly once
pnpm bench:gaps:all    # both, one after the other
```

It builds the ingest image, wipes its own volumes and removes the stack on exit. This page records no result of it: quote
the output of your own run (`pnpm bench:gaps:all`) with its date and commit.

## Not measured yet

- Multiple replicas against one broker (needs more cores than this machine has).
- Long-running soak with partition rollover and retention drops.
- PostgreSQL tuned for write throughput (WAL sizing; [`synchronous_commit`](#synchronous_commit) was measured).

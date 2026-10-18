-- IMP-13.1: where does one flush spend its time?
--
-- Replays the statements of BatchWriter.commit (apps/ingest/src/telemetry/batch-writer.service.ts) for a
-- batch shaped like the benchmark's, on the bench database that `deploy/bench/run-baseline.sh --keep`
-- leaves running (Compose project itp-bench). Run it with:
--
--   docker compose -p itp-bench -f deploy/bench/docker-compose.replicas.yml exec -T postgres \
--     psql -U postgres -d telemetry < deploy/bench/explain-flush.sql
--
-- Part A runs each statement under EXPLAIN (ANALYZE, BUFFERS, WAL) inside a transaction that is rolled
-- back: the plan, the time of every node and, below it, the `Trigger for constraint ...` lines (the
-- foreign keys from `reading` and `rollup_1m` to `device`). Part B runs the same statements plainly,
-- timed by psql, and COMMITS them, so the time of COMMIT (the WAL flush) is seen; it adds about 7 000
-- rows to the bench database. The arrays travel as psql variables, so the statements carry them as the
-- application's do ($1::text[] ...). Run the script twice and read the second run (warm caches), and
-- once on loaded tables and once after `TRUNCATE reading, rollup_1m` (the tables a run starts with).
-- Throwaway database only: never point it at a database worth keeping.

\set ON_ERROR_STOP on
\timing off

SELECT (SELECT count(*) FROM reading) AS readings_before, (SELECT count(*) FROM rollup_1m) AS rollups_before;

\echo
\echo '=== Part A: EXPLAIN (ANALYZE, BUFFERS, WAL), rolled back'
BEGIN;

-- 3 500 messages round-robin over the six devices of apps/ingest/config/devices.json, 10 ms apart, one
-- reading per metric of the device: about 7 000 readings, as one flush of the benchmark. The base time
-- is the clock, so every run of this script writes keys of its own.
CREATE TEMP TABLE batch ON COMMIT DROP AS
WITH base AS (
  SELECT clock_timestamp() - interval '10 minutes' AS t
), msg AS (
  SELECT n,
         (ARRAY['dc-env-01', 'dc-env-02', 'lib-air-01', 'lha-air-01', 'stu-air-01', 'hub-power-01'])[1 + n % 6] AS device_id,
         base.t + n * interval '10 milliseconds' AS ts
  FROM generate_series(1, 3500) AS n, base
), registered (device_id, metric) AS (
  VALUES ('dc-env-01', 'temperature_c'), ('dc-env-01', 'humidity_pct'),
         ('dc-env-02', 'temperature_c'), ('dc-env-02', 'humidity_pct'),
         ('lib-air-01', 'co2_ppm'), ('lib-air-01', 'temperature_c'), ('lib-air-01', 'humidity_pct'),
         ('lha-air-01', 'co2_ppm'), ('lha-air-01', 'temperature_c'),
         ('stu-air-01', 'co2_ppm'), ('stu-air-01', 'temperature_c'),
         ('hub-power-01', 'power_kw')
)
SELECT row_number() OVER (ORDER BY msg.n, registered.metric) AS k,
       msg.device_id, registered.metric, msg.ts, (20 + msg.n % 10)::float8 AS value
FROM msg JOIN registered USING (device_id);

SELECT count(*) AS readings_in_batch FROM batch;

SELECT array_agg(device_id ORDER BY k)::text AS dev,
       array_agg(metric ORDER BY k)::text AS met,
       array_agg(ts ORDER BY k)::text AS tss,
       array_agg(value ORDER BY k)::text AS vals
FROM batch \gset

-- What rollup() in rollup.ts gives: one row per device, metric and minute, sorted by that key (IMP-09.1).
CREATE TEMP TABLE rolled ON COMMIT DROP AS
SELECT device_id, metric,
       date_bin('1 minute', ts, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS bucket,
       count(*)::int AS cnt, sum(value) AS total, min(value) AS lo, max(value) AS hi
FROM batch GROUP BY 1, 2, 3;

SELECT count(*) AS rollup_rows_in_batch FROM rolled;

SELECT array_agg(device_id ORDER BY device_id, metric, bucket)::text AS r_dev,
       array_agg(metric ORDER BY device_id, metric, bucket)::text AS r_met,
       array_agg(bucket ORDER BY device_id, metric, bucket)::text AS r_bkt,
       array_agg(cnt ORDER BY device_id, metric, bucket)::text AS r_cnt,
       array_agg(total ORDER BY device_id, metric, bucket)::text AS r_sum,
       array_agg(lo ORDER BY device_id, metric, bucket)::text AS r_min,
       array_agg(hi ORDER BY device_id, metric, bucket)::text AS r_max
FROM rolled \gset

-- What recordDevices() sends to the ledger: one row per device touched.
SELECT array_agg(device_id ORDER BY device_id)::text AS d_id,
       array_agg(seq ORDER BY device_id)::text AS d_seq,
       array_agg(last_ts ORDER BY device_id)::text AS d_ts,
       array_agg('[]'::text ORDER BY device_id)::text AS d_holes,
       array_agg(last_ts ORDER BY device_id)::text AS d_seen
FROM (
  SELECT device_id, (5000000 + row_number() OVER (ORDER BY device_id))::bigint AS seq, max(ts) AS last_ts
  FROM batch GROUP BY device_id
) AS x \gset

\echo
\echo '--- A1: INSERT INTO reading ... ON CONFLICT DO NOTHING RETURNING'
EXPLAIN (ANALYZE, BUFFERS, WAL)
INSERT INTO reading (device_id, metric, ts, value)
SELECT * FROM unnest(:'dev'::text[], :'met'::text[], :'tss'::timestamptz[], :'vals'::float8[])
ON CONFLICT DO NOTHING
RETURNING device_id, metric, ts, value;

\echo
\echo '--- A2: INSERT INTO rollup_1m ... ON CONFLICT DO UPDATE'
EXPLAIN (ANALYZE, BUFFERS, WAL)
INSERT INTO rollup_1m (device_id, metric, bucket, count, sum, min, max)
SELECT * FROM unnest(:'r_dev'::text[], :'r_met'::text[], :'r_bkt'::timestamptz[], :'r_cnt'::int[],
                     :'r_sum'::float8[], :'r_min'::float8[], :'r_max'::float8[])
ON CONFLICT (device_id, metric, bucket) DO UPDATE SET
  count = rollup_1m.count + EXCLUDED.count,
  sum   = rollup_1m.sum + EXCLUDED.sum,
  min   = LEAST(rollup_1m.min, EXCLUDED.min),
  max   = GREATEST(rollup_1m.max, EXCLUDED.max);

\echo
\echo '--- A3: SELECT ... FROM device ... FOR NO KEY UPDATE'
EXPLAIN (ANALYZE, BUFFERS, WAL)
SELECT id, last_seq, seq_last_ts, seq_holes FROM device WHERE id = ANY(:'d_id'::text[])
ORDER BY id FOR NO KEY UPDATE;

\echo
\echo '--- A4: UPDATE device ... FROM unnest(...)'
EXPLAIN (ANALYZE, BUFFERS, WAL)
UPDATE device d SET last_seq = v.last_seq, seq_last_ts = v.last_ts,
  seq_holes = v.holes::jsonb, last_seen = GREATEST(d.last_seen, v.last_seen)
FROM unnest(:'d_id'::text[], :'d_seq'::bigint[], :'d_ts'::timestamptz[], :'d_holes'::text[],
            :'d_seen'::timestamptz[]) AS v(id, last_seq, last_ts, holes, last_seen)
WHERE d.id = v.id;

ROLLBACK;

-- ---------------------------------------------------------------------------------------------------
\echo
\echo '=== Part B: the same statements, plainly, timed by psql, and committed'
\timing on
BEGIN;

-- RETURNING feeds a count here, so 7 000 rows are not printed; the server still builds them.
WITH ins AS (
  INSERT INTO reading (device_id, metric, ts, value)
  SELECT * FROM unnest(:'dev'::text[], :'met'::text[], :'tss'::timestamptz[], :'vals'::float8[])
  ON CONFLICT DO NOTHING
  RETURNING device_id, metric, ts, value
)
SELECT count(*) AS inserted FROM ins;

INSERT INTO rollup_1m (device_id, metric, bucket, count, sum, min, max)
SELECT * FROM unnest(:'r_dev'::text[], :'r_met'::text[], :'r_bkt'::timestamptz[], :'r_cnt'::int[],
                     :'r_sum'::float8[], :'r_min'::float8[], :'r_max'::float8[])
ON CONFLICT (device_id, metric, bucket) DO UPDATE SET
  count = rollup_1m.count + EXCLUDED.count,
  sum   = rollup_1m.sum + EXCLUDED.sum,
  min   = LEAST(rollup_1m.min, EXCLUDED.min),
  max   = GREATEST(rollup_1m.max, EXCLUDED.max);

SELECT id, last_seq, seq_last_ts, seq_holes FROM device WHERE id = ANY(:'d_id'::text[])
ORDER BY id FOR NO KEY UPDATE;

UPDATE device d SET last_seq = v.last_seq, seq_last_ts = v.last_ts,
  seq_holes = v.holes::jsonb, last_seen = GREATEST(d.last_seen, v.last_seen)
FROM unnest(:'d_id'::text[], :'d_seq'::bigint[], :'d_ts'::timestamptz[], :'d_holes'::text[],
            :'d_seen'::timestamptz[]) AS v(id, last_seq, last_ts, holes, last_seen)
WHERE d.id = v.id;

COMMIT;
\timing off

SELECT (SELECT count(*) FROM reading) AS readings_after, (SELECT count(*) FROM rollup_1m) AS rollups_after;

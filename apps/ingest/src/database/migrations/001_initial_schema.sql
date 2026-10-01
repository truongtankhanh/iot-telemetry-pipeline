-- Device registry, partitioned raw readings, per-minute rollups, alerts and the delivery outbox.

CREATE TABLE device (
  id          text PRIMARY KEY,
  kind        text NOT NULL,
  zone_code   text NOT NULL,
  name        text NOT NULL,
  metrics     text[] NOT NULL,
  last_seen   timestamptz,
  last_seq    bigint
);

-- Raw readings, range-partitioned by day. The primary key makes redelivery harmless (ADR-0003).
CREATE TABLE reading (
  device_id   text NOT NULL REFERENCES device (id),
  metric      text NOT NULL,
  ts          timestamptz NOT NULL,
  value       double precision NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, metric, ts)
) PARTITION BY RANGE (ts);

-- Per-minute summaries, maintained in the same transaction as the insert.
CREATE TABLE rollup_1m (
  device_id   text NOT NULL REFERENCES device (id),
  metric      text NOT NULL,
  bucket      timestamptz NOT NULL,
  count       integer NOT NULL,
  sum         double precision NOT NULL,
  min         double precision NOT NULL,
  max         double precision NOT NULL,
  PRIMARY KEY (device_id, metric, bucket)
);

CREATE TABLE alert (
  id            bigserial PRIMARY KEY,
  device_id     text NOT NULL REFERENCES device (id),
  rule_id       text NOT NULL,
  metric        text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title         text NOT NULL,
  status        text NOT NULL CHECK (status IN ('open', 'cleared')),
  opened_at     timestamptz NOT NULL,
  opened_value  double precision NOT NULL,
  cleared_at    timestamptz,
  cleared_value double precision,
  -- Id of the incident created in the command center, once delivered.
  external_ref  text
);

-- At most one open alert per device and rule, even with several replicas racing (ADR-0004).
CREATE UNIQUE INDEX alert_one_open_per_rule ON alert (device_id, rule_id) WHERE status = 'open';
CREATE INDEX alert_status_opened ON alert (status, opened_at DESC);

-- Transactional outbox (ADR-0005).
CREATE TABLE alert_delivery (
  id            bigserial PRIMARY KEY,
  alert_id      bigint NOT NULL REFERENCES alert (id),
  event         text NOT NULL CHECK (event IN ('opened', 'cleared')),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'delivered', 'skipped', 'failed')),
  attempts      integer NOT NULL DEFAULT 0,
  next_attempt  timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz
);

CREATE INDEX alert_delivery_due ON alert_delivery (next_attempt) WHERE status = 'pending';

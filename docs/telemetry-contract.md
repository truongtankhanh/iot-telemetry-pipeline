# Telemetry contract

What a device (or gateway) must publish for the pipeline to accept it. The rules below are
implemented once, in [`@itp/telemetry-contract`](../packages/telemetry-contract/src/index.ts),
which firmware tooling, the [simulator](../apps/simulator) and the ingest service all import — so
this page, the parser and the simulator cannot drift apart without a test failing.

## 1. Topic

```
campus/<zoneCode>/<deviceId>/telemetry
```

- Exactly four segments; the first is `campus`, the last is `telemetry`.
- `zoneCode` and `deviceId` match `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`.
- `zoneCode` must be the zone registered for that device in `devices.json`. A device publishing
  under another zone is rejected (`zone_mismatch`), which also stops a misconfigured device from
  writing into a neighbouring zone.

Example: `campus/BLD-DC/dc-env-01/telemetry`.

## 2. Payload

UTF-8 JSON, one object per message:

```json
{
  "seq": 4217,
  "ts": "2026-10-16T08:00:02.000Z",
  "metrics": { "temperature_c": 24.3, "humidity_pct": 41.8 }
}
```

| Field     | Type    | Rules                                                                                                      |
| --------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `seq`     | integer | Safe integer ≥ 0. Increments by 1 on every message the device sends.                                       |
| `ts`      | string  | Time of the measurement, ISO 8601 with a zone (`Z` or `±HH:mm`), calendar-valid. Stored normalised to UTC. |
| `metrics` | object  | One or more metric names mapped to finite numbers. An empty object is rejected.                            |

`ts` must be `YYYY-MM-DDTHH:mm:ss`, an optional fraction of 1 to 9 digits, then `Z` or `±HH:mm`. `T` and `Z` are
uppercase, the hour is 00 to 23 (`24:00:00` is rejected) and the date must exist in the calendar. Zone-less,
date-only and space-separated values are rejected, never read as local time.

A payload larger than 4096 bytes (`MAX_PAYLOAD_BYTES`) is rejected with the reason `size` before it is
decoded. A legitimate message is a few hundred bytes.

All metrics in one message share the message's `ts`. Send them together when they were sampled
together; the pipeline stores one row per metric.

### Metrics

| Metric          | Unit | Accepted range |
| --------------- | ---- | -------------- |
| `temperature_c` | °C   | −40 … 85       |
| `humidity_pct`  | %    | 0 … 100        |
| `co2_ppm`       | ppm  | 0 … 10 000     |
| `power_kw`      | kW   | 0 … 10 000     |

A metric must be both **known to the contract** (table above) and **listed for that device** in
`devices.json`. To introduce a new metric, add it to `METRICS` in the contract first (see
[development.md](development.md#add-a-metric)).

## 3. Transport

| Setting        | Value                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Protocol       | The service subscribes with MQTT 5 (needed for shared subscriptions). Publishers may use any version the broker supports.                                                                                    |
| QoS            | **1** (at least once). The pipeline tolerates redelivery.                                                                                                                                                    |
| Retain         | Off. Telemetry is a stream, not state.                                                                                                                                                                       |
| Cadence        | Whatever the sensor needs; the load model in [benchmarks](benchmarks.md) assumes one message every few seconds per device.                                                                                   |
| Authentication | Broker-specific: anonymous in the dev Mosquitto config; username/password or X.509 client certificates elsewhere. On AWS IoT Core a device connects as its thing name and may publish only to its own topic. |

## 4. Sequence numbers

`seq` is how the pipeline measures completeness.

- Keep a counter **per device**, start it at 0 or 1 and add 1 for every message.
- Persist it across reboots if you can. A message whose `seq` is lower than the highest seen, that
  fills no open gap, **and whose `ts` is newer than the message that carried that highest `seq`**
  is a device restart: the service counts on from the new value without reporting a gap, and
  closes the gaps still open for the previous run as lost. The size of the step back does not
  matter. A device that restarts must therefore keep a `ts` that moves forward.
- Any other step backwards (an older `ts`) is a redelivery, or a late message that fills an open gap.
- A jump forwards by _n_ opens a gap of _n − 1_ messages. A gap still open after
  `SEQUENCE_GRACE_MS` (30 s by default) is counted once in `telemetry_sequence_gaps_total`; a
  message that arrives before then, out of order, closes it without being counted.

Gaps are counted from a ledger in PostgreSQL, so the count does not depend on how many ingest
processes share the subscription; see [operations.md](operations.md#known-limitations).

## 5. Timestamps and late data

| Condition                                                | Outcome             |
| -------------------------------------------------------- | ------------------- |
| `ts` more than 5 minutes in the future                   | rejected: `future`  |
| `ts` before the start of the oldest kept daily partition | rejected: `too_old` |
| Anything in between                                      | accepted            |

The "oldest kept partition" is the start (UTC) of the day two days ago, or less if
`RETENTION_DAYS` is smaller. In practice a device that was offline can backfill **up to roughly two
to three days** of readings; anything older is rejected rather than silently written nowhere. Late
readings that are accepted are stored and rolled up normally, but rules evaluate readings as they
are stored, so a backfilled reading is judged after newer ones already seen. Do not rely on rules
for backfilled data.

Devices without a trusted clock should send the time they received the measurement from their
gateway rather than an uncalibrated RTC value.

## 6. Rejections

Every rejected message increments `telemetry_messages_total{result="rejected"}` and
`telemetry_rejections_total{reason=…}`. Reasons are a small fixed set, never free text.

| Reason                  | Cause                                                            | Raised by      |
| ----------------------- | ---------------------------------------------------------------- | -------------- |
| `topic`                 | Wrong shape, wrong root/suffix, or a segment fails the pattern   | contract       |
| `size`                  | Payload larger than 4096 bytes, checked before decoding          | contract       |
| `json`                  | Payload is not valid JSON                                        | contract       |
| `shape`                 | Payload (or `metrics`) is not an object                          | contract       |
| `seq`                   | Missing, negative, non-integer or unsafe `seq`                   | contract       |
| `ts`                    | Missing, unparseable, zone-less or calendar-invalid `ts`         | contract       |
| `empty`                 | `metrics` has no entries                                         | contract       |
| `metric`                | A metric name the contract does not define                       | contract       |
| `value`                 | A metric value that is not a finite number                       | contract       |
| `range`                 | A metric value outside its accepted range                        | contract       |
| `unknown_device`        | `deviceId` is not in `devices.json`                              | ingest service |
| `zone_mismatch`         | Topic zone differs from the device's registered zone             | ingest service |
| `future`                | `ts` is more than 5 minutes ahead of the server clock            | ingest service |
| `too_old`               | `ts` is before the oldest accepted time                          | ingest service |
| `metric_not_registered` | The device reported a metric not listed for it in `devices.json` | ingest service |

A message is **all or nothing**: one bad metric rejects the whole message. For `future`, `too_old`
and `metric_not_registered` the message's `seq` has already been counted, so these show up as
rejections but not as gaps.

## 7. Onboarding a device

1. Choose an id and zone. The zone code must exist in ops-command-center, otherwise alert delivery
   for that device fails with `zone <code> does not exist in ops-command-center`.
2. Add it to [`apps/ingest/config/devices.json`](../apps/ingest/config/devices.json) with its
   `kind`, `zoneCode`, `name` and the `metrics` it reports. See [configuration.md](configuration.md#devicesjson).
3. If its `kind` is new, add rules for it in `rules.json`; otherwise the existing rules for that
   kind apply automatically.
4. Deploy the registry (it is read at boot and upserted into the `device` table; restart or roll
   the replicas).
5. Broker side: create the account/ACL (Mosquitto), or the thing, certificate and policy (AWS IoT
   Core), allowing the device to publish only to `campus/<zoneCode>/<deviceId>/telemetry`.
6. Verify: `GET /api/devices` shows a `lastSeen` timestamp, and `telemetry_rejections_total` does
   not grow.

Device provisioning through an API is planned ([ITP-17](roadmap.md)).

## 8. Try it by hand

```bash
mosquitto_pub -V mqttv5 -h localhost -q 1 \
  -t campus/BLD-DC/dc-env-01/telemetry \
  -m '{"seq":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","metrics":{"temperature_c":24.3}}'

curl "localhost:3100/api/devices/dc-env-01/readings?metric=temperature_c&resolution=raw"
```

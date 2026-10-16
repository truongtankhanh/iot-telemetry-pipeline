# HTTP API

A small **read-only** API for dashboards and operators, plus the probe and metrics endpoints. The
service listens on `PORT` (default `3100`). Everything is under `/api` except `/metrics`.

An interactive OpenAPI document is served at `/api/docs` (for example
<http://localhost:3100/api/docs>) when `API_DOCS_ENABLED=true`. It is on in local development and
the Compose demo and off by default elsewhere, including the Kubernetes base.

> **There is no authentication on this API.** It is meant to be reached from inside the platform's
> network only. See [operations.md](operations.md#security-posture) before exposing it anywhere.

Requests are validated strictly: an unknown query parameter or a malformed value returns `400`
with the validation messages.

## Endpoints

| Method | Path                        | Purpose                                              |
| ------ | --------------------------- | ---------------------------------------------------- |
| GET    | `/api/devices`              | Registered devices and when each was last heard from |
| GET    | `/api/devices/:id/readings` | Readings of one device and metric over a time range  |
| GET    | `/api/alerts`               | Recent alerts with the state of their delivery       |
| GET    | `/api/health`               | Liveness                                             |
| GET    | `/api/ready`                | Readiness (database and broker)                      |
| GET    | `/metrics`                  | Prometheus exposition                                |

### GET /api/devices

Devices from `devices.json`, with `lastSeen` taken from the database (the newest measurement time
stored for the device, or `null` if none yet).

```json
[
  {
    "id": "dc-env-01",
    "kind": "server_room",
    "zoneCode": "BLD-DC",
    "name": "Data center — row A",
    "metrics": ["temperature_c", "humidity_pct"],
    "lastSeen": "2026-10-16T08:00:02.000Z"
  }
]
```

### GET /api/devices/:id/readings

| Query        | Required | Default       | Notes                                              |
| ------------ | -------- | ------------- | -------------------------------------------------- |
| `metric`     | yes      | —             | A metric the device reports, e.g. `temperature_c`. |
| `from`       | no       | `to` − 1 hour | ISO 8601, inclusive.                               |
| `to`         | no       | now           | ISO 8601, exclusive.                               |
| `resolution` | no       | `1m`          | `1m` per-minute summaries, or `raw` readings.      |

`resolution=1m` reads the rollup table (`count`, average, `min`, `max` per minute):

```json
{
  "deviceId": "dc-env-01",
  "metric": "temperature_c",
  "resolution": "1m",
  "from": "2026-10-16T07:00:00.000Z",
  "to": "2026-10-16T08:00:00.000Z",
  "points": [
    { "bucket": "2026-10-16T07:59:00.000Z", "count": 30, "avg": 24.31, "min": 23.9, "max": 24.8 }
  ]
}
```

`resolution=raw` returns individual readings, **oldest first, capped at 5 000 points**:

```json
{
  "deviceId": "dc-env-01",
  "metric": "temperature_c",
  "resolution": "raw",
  "from": "…",
  "to": "…",
  "points": [{ "ts": "2026-10-16T07:59:02.000Z", "value": 24.3 }]
}
```

- The cap is silent: if a range holds more than 5 000 readings you get the **earliest** 5 000.
  Narrow the range or use `1m`.
- `1m` has no cap; a 30-day range is up to 43 200 buckets. Ask for what a chart can show.
- `404` if the device is not registered, or the device does not report that metric.

### GET /api/alerts

| Query    | Notes                          |
| -------- | ------------------------------ |
| `status` | Optional: `open` or `cleared`. |

Returns up to **200** alerts, most recently opened first:

```json
[
  {
    "id": "7",
    "deviceId": "dc-env-01",
    "ruleId": "server-room-hot",
    "metric": "temperature_c",
    "severity": "high",
    "title": "Server room temperature high",
    "status": "cleared",
    "openedAt": "2026-10-16T08:00:26.000Z",
    "openedValue": 29.3,
    "clearedAt": "2026-10-16T08:01:30.000Z",
    "clearedValue": 25.1,
    "externalRef": "c3a1…",
    "deliveryStatus": "delivered",
    "deliveryAttempts": 1,
    "deliveryError": null
  }
]
```

| Field                                     | Meaning                                                                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`                                  | `open` or `cleared`.                                                                                                                                               |
| `externalRef`                             | The incident id in ops-command-center, once the `opened` event was delivered; else `null`.                                                                         |
| `deliveryStatus` / `…Attempts` / `…Error` | State of the alert's **latest** outbox event (opened, or cleared if it has cleared): `pending`, `delivered`, `skipped` (no command center configured) or `failed`. |

Ids are returned as strings (they are `bigint` in PostgreSQL).

### GET /api/health and /api/ready

```json
{ "status": "ok" }
```

```json
{ "status": "ready", "database": "up", "broker": "up" }
```

`/api/ready` returns **503** with `{ "status": "not ready", "database": "up|down", "broker": "up|down" }`
when either dependency is down. The broker counts as up while **at least one** of the process's
MQTT connections is connected. Kubernetes uses `/api/health` for liveness and startup and
`/api/ready` for readiness; see [operations.md](operations.md#health-and-probes).

### GET /metrics

Prometheus text format, at the root (not under `/api`). Metric names and meanings:
[operations.md](operations.md#metrics).

## Examples

```bash
curl localhost:3100/api/devices
curl "localhost:3100/api/devices/dc-env-01/readings?metric=temperature_c"
curl "localhost:3100/api/devices/dc-env-01/readings?metric=temperature_c&resolution=raw&from=2026-10-16T08:00:00Z&to=2026-10-16T08:05:00Z"
curl "localhost:3100/api/alerts?status=open"
```

## Not in this API

There are no write endpoints. The device registry and rules are files
([configuration.md](configuration.md)); a provisioning API ([ITP-17](roadmap.md)) and a rules
editor ([ITP-18](roadmap.md)) are on the roadmap. Alerts reach operators as incidents in
ops-command-center, not through this API.

# HTTP API

A small **read-only** API for dashboards and operators, plus the probe and metrics endpoints. The
service listens on `PORT` (default `3100`). Everything is under `/api` except `/metrics`.

An interactive OpenAPI document is served at `/api/docs` (for example
<http://localhost:3100/api/docs>) when `API_DOCS_ENABLED=true`. It is on in local development and
the Compose demo and off by default elsewhere, including the Kubernetes base.

The machine-readable reference is [openapi.json](openapi.json): it lists every route with its
parameters, its response schemas and its error answers. It is generated from the controllers
(`pnpm docs:openapi`), not written by hand, and CI fails when it differs from the code, so it is the
one to build a client from. The examples on this page are the human version of the same shapes.

> **There is no authentication on this API.** It is meant to be reached from inside the platform's
> network only. See [operations.md](operations.md#security-posture) before exposing it anywhere.

Requests are validated strictly: an unknown query parameter or a malformed value returns `400`
with the validation messages. Errors share one envelope, except the `503` of `/api/ready`; see
[Errors](#errors).

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

| Query        | Required | Default       | Notes                                                                                      |
| ------------ | -------- | ------------- | ------------------------------------------------------------------------------------------ |
| `metric`     | yes      | —             | One of `temperature_c`, `humidity_pct`, `co2_ppm`, `power_kw`, and one the device reports. |
| `from`       | no       | `to` − 1 hour | ISO 8601 with a zone, inclusive. Must be earlier than `to`.                                |
| `to`         | no       | now           | ISO 8601 with a zone, exclusive.                                                           |
| `resolution` | no       | `1m`          | `1m` per-minute summaries, or `raw` readings.                                              |

`from` and `to` are read as strictly as the `ts` of a telemetry message
([telemetry-contract.md](telemetry-contract.md)): `YYYY-MM-DDTHH:mm:ss`, an optional fraction of 1 to 9
digits, then `Z` or `±HH:mm`, and a date that exists. Text with no zone, a date alone, a bare number
or `24:00:00` is `400`. In a URL a `+` is a space, so write an offset as `%2B`
(`from=2026-10-17T17:00:00%2B07:00`) or use `Z`.

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

`resolution=raw` returns individual readings, **oldest first, up to 5 000 points per response**:

```json
{
  "deviceId": "dc-env-01",
  "metric": "temperature_c",
  "resolution": "raw",
  "from": "…",
  "to": "…",
  "truncated": false,
  "nextFrom": null,
  "points": [{ "ts": "2026-10-16T07:59:02.000Z", "value": 24.3 }]
}
```

- `truncated` is `true` when the range holds more than 5 000 readings: the response has the
  **earliest** 5 000 and `nextFrom` is the time of the first one left out. When it is `false`,
  `nextFrom` is `null` and nothing is missing. A response without `truncated` (an older replica
  during a rolling deploy) does not say either way.
- `resolution=1m` accepts a range of at most **10 080 minutes (7 days)**, which is also the most
  buckets a response can hold. A longer range is `400`; ask for what a chart can show. The limit
  does not apply to `raw`, which is bounded by the 5 000 points.
- `400` if `from` is not earlier than `to` (an empty or reversed range, or a `from` in the future when
  `to` is left to default to now), if `from` or `to` is not a timestamp with a zone, if `metric` is
  not one of the four names above, or if a `1m` range is longer than 7 days.
- `404` if the device is not registered, or the device does not report that metric.

#### Paging raw readings

Repeat the request with `from` set to `nextFrom` and the **same `to`** as the response, until
`truncated` is `false`. `from` is inclusive and a device has one reading per metric and instant, so
the pages neither overlap nor leave a gap. Keep `to` fixed: left to default to now, it would move
between requests.

```bash
curl "localhost:3100/api/devices/dc-env-01/readings?metric=temperature_c&resolution=raw&from=2026-10-16T00:00:00Z&to=2026-10-17T00:00:00Z"
# …"truncated": true, "nextFrom": "2026-10-16T01:23:20.000Z"
curl "localhost:3100/api/devices/dc-env-01/readings?metric=temperature_c&resolution=raw&from=2026-10-16T01:23:20.000Z&to=2026-10-17T00:00:00Z"
```

### GET /api/alerts

| Query    | Notes                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ |
| `status` | Optional: `open` or `cleared`.                                                                   |
| `limit`  | Optional: alerts per page, 1 to 200. Default 200.                                                |
| `before` | Optional: where the previous page ended, taken from its `X-Next-Cursor` header. Do not build it. |

Returns up to `limit` (default **200**) alerts, most recently opened first, as a JSON array:

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

#### Paging alerts

The body is always the array above. When more alerts follow, the response carries the header
`X-Next-Cursor`; repeat the request with `before` set to its value, and the same `status` and
`limit`, until a response has no such header. Alerts opened at the same instant are ordered by id,
so none is skipped or repeated at a page boundary.

```bash
curl -i "localhost:3100/api/alerts?limit=2"
# …X-Next-Cursor: eyJ0IjoiMjAyNi0xMC0xNlQwODowMDoyNi4wMDBaIiwiaWQiOiI3In0
curl -i "localhost:3100/api/alerts?limit=2&before=eyJ0IjoiMjAyNi0xMC0xNlQwODowMDoyNi4wMDBaIiwiaWQiOiI3In0"
```

- The cursor is opaque and its format may change: pass it back unchanged, never build one. A `before`
  that this API did not return is `400`.
- `limit` and `before` are new. During a rolling deploy an older replica answers `400` to a request
  that uses them, so do not rely on paging until a deploy has finished. A cursor made by one version
  means nothing to an older one.

### GET /api/health and /api/ready

```json
{ "status": "ok" }
```

```json
{ "status": "ready", "database": "up", "broker": "up", "alertSink": "ops-command-center" }
```

`/api/ready` returns **503** with
`{ "status": "not ready", "database": "up|down", "broker": "up|down", "alertSink": "none|ops-command-center" }`
when either dependency is down. The broker counts as up while **at least one** of the process's
MQTT connections is connected. `alertSink` is `none` when no command center is configured
(`OCC_API_URL` unset: alerts are recorded and marked `skipped`, never delivered) and
`ops-command-center` otherwise. It is informational: it never turns a response into a 503.
Kubernetes uses `/api/health` for liveness and startup and `/api/ready` for readiness; see
[operations.md](operations.md#health-and-probes).

### GET /metrics

Prometheus text format, at the root (not under `/api`). Metric names and meanings:
[operations.md](operations.md#metrics).

## Errors

Errors use Nest's standard body: `statusCode`, `error` (the status text) and `message`. The type of
`message` depends on who refused the request:

- **`400` from the validation of the query**: `message` is an **array** of strings, one per problem
  (an unknown `metric`, a `from` or `to` that is not a timestamp with a zone, a bad `limit`).

  ```json
  {
    "message": [
      "metric must be one of the following values: temperature_c, humidity_pct, co2_ppm, power_kw"
    ],
    "error": "Bad Request",
    "statusCode": 400
  }
  ```

- **`400` from a check the handler makes** (for example a range whose `from` is not earlier than
  `to`, or a `before` that is not a cursor this API returned): `message` is a **string**. Problems
  with `limit` (not a whole number from 1 to 200) come from the validation, so their `message` is an
  array.

  ```json
  { "message": "\"from\" must be earlier than \"to\"", "error": "Bad Request", "statusCode": 400 }
  ```

- **`404`**: `message` is a string, for example `Device ghost-01 is not registered` or
  `Device dc-env-01 does not report co2_ppm`.
- **`503`** from `/api/ready`: the readiness body shown [above](#get-apihealth-and-apiready).

A client should accept both forms of `message`. The validation runs before the handler, so a
malformed query is `400` even for a device that is not registered; do not rely on which of two
simultaneous problems is reported first.

## Request id

Every response carries an `X-Request-Id` header, the answers to `404`, `400` and `503` included, and the probes and `/metrics` too. A client may send its own: it is used as it is
if it is 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `.`, `_` and `-`. Anything else (a space, a line break, a longer value, a repeated header) is replaced by a new UUID, never
rejected, so the response header is always the value to quote. The id is also written on the server's JSON log lines for that request (see
[operations](operations.md#logs)). During a rolling deploy an older pod sends no such header, so a client must treat it as optional.

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

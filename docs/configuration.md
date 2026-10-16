# Configuration

Everything the ingest service reads: environment variables, the device registry and the alert
rules. Environment variables are validated at startup by
[`env.validation.ts`](../apps/ingest/src/config/env.validation.ts); if anything is wrong the
service refuses to start and prints every problem at once.

## Environment variables

### Service and database

| Variable          | Default  | Notes                                                                                                                 |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `3100`   | HTTP port for the API, probes and `/metrics`. 1–65535.                                                                |
| `DATABASE_URL`    | —        | **Required.** PostgreSQL 14+ (CI and Compose run 17). Without a password in the URL, `pg` falls back to `PGPASSWORD`. |
| `MIGRATE_ON_BOOT` | `true`   | Apply `src/database/migrations/*.sql` on start, under an advisory lock so several replicas can boot together.         |
| `CONFIG_DIR`      | `config` | Directory holding `devices.json` and `rules.json`. The image sets `/app/config`.                                      |

### MQTT

| Variable                                         | Default                 | Notes                                                                                                                                                            |
| ------------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MQTT_URL`                                       | `mqtt://localhost:1883` | `mqtts://…:8883` for TLS (AWS IoT Core).                                                                                                                         |
| `MQTT_SHARE_GROUP`                               | `ingest`                | Shared-subscription group ([ADR-0001](adr/0001-mqtt-shared-subscriptions.md)). Empty subscribes without sharing — only safe with a single replica.               |
| `MQTT_CONNECTIONS`                               | `1`                     | 1–32 connections per process, all in the same group. For brokers that cap delivery per connection (IoT Core: 100 messages/s).                                    |
| `MQTT_CLIENT_ID_PREFIX`                          | `ingest`                | Client ids are `<prefix>-<hostname>-<pid>-<n>`, so a broker policy can allow `<prefix>-*`.                                                                       |
| `MQTT_USERNAME` / `MQTT_PASSWORD`                | —                       | Optional broker credentials.                                                                                                                                     |
| `MQTT_CA_PEM` / `MQTT_CERT_PEM` / `MQTT_KEY_PEM` | —                       | PEM text; real newlines or `\n` escapes. Certificate and key must be set together. Omit the CA when the broker's CA is in Node's trust store (Amazon Root CA 1). |

### Write path and retention

| Variable             | Default | Notes                                                                                                                                                           |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FLUSH_INTERVAL_MS`  | `250`   | 10–5000. Upper bound on how long a reading waits in memory — and on the loss window of a hard crash ([ADR-0002](adr/0002-ack-on-receipt-with-bounded-loss.md)). |
| `FLUSH_MAX_READINGS` | `1000`  | 1–20 000. Flush early when this many readings are buffered.                                                                                                     |
| `RETENTION_DAYS`     | `30`    | Raw readings (whole-day partitions) and rollups older than this are dropped hourly.                                                                             |

### Delivery to ops-command-center

| Variable               | Default | Notes                                                                                                                                    |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `OCC_API_URL`          | —       | Base URL of its API, e.g. `http://localhost:18080/api`. **Unset = alerts are recorded, never delivered** (outbox rows become `skipped`). |
| `OCC_TOKEN_URL`        | —       | Keycloak token endpoint of the `occ` realm. Set with the next two, or none.                                                              |
| `OCC_CLIENT_ID`        | —       | `telemetry-pipeline`.                                                                                                                    |
| `OCC_CLIENT_SECRET`    | —       | The client's secret. Inject it from a secret store; never commit it.                                                                     |
| `DELIVERY_INTERVAL_MS` | `1000`  | ≥ 100. How often the outbox worker looks for due rows.                                                                                   |

Cross-field checks at startup: the three `OCC_*` credentials are all-or-nothing, they require
`OCC_API_URL`, and a certificate requires its key.

Empty strings count as unset for the optional `OCC_*` and `MQTT_*_PEM` variables, so `FOO=` in a
Compose file or shell behaves like leaving it out.

## devices.json

The device registry, reviewed as code. Read at boot, validated, upserted into the `device` table
and served from memory. Unknown devices are rejected at ingest.

```json
{
  "devices": [
    {
      "id": "dc-env-01",
      "kind": "server_room",
      "zoneCode": "BLD-DC",
      "name": "Data center — row A",
      "metrics": ["temperature_c", "humidity_pct"]
    }
  ]
}
```

| Field      | Rules                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| `id`       | Required, unique. Matches the MQTT topic segment (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`). |
| `kind`     | Required. Groups devices for rules (`server_room`, `indoor_air`, `power_meter` today). |
| `zoneCode` | Required. Must match the topic's zone and a zone in ops-command-center.                |
| `name`     | Required. Shown in the API and in incident descriptions.                               |
| `metrics`  | Required, non-empty. Each must be defined in the contract's `METRICS`.                 |

Removing a device from the file stops it being accepted, but its history stays in the database
until retention removes it.

## rules.json

Threshold rules per device **kind** and **metric**, with hysteresis
([ADR-0004](adr/0004-rules-with-hysteresis.md)). Validated against the registry at boot: a rule
for a kind or metric no device has is an error.

```json
{
  "id": "server-room-hot",
  "kind": "server_room",
  "metric": "temperature_c",
  "direction": "above",
  "raise": 27,
  "clear": 25.5,
  "for": 3,
  "severity": "high",
  "incidentType": "equipment_fault",
  "title": "Server room temperature high"
}
```

| Field          | Rules                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | Required, unique. Stored on each alert; also the identity used to keep "one open alert per device and rule".                                                                                             |
| `kind`         | Required. A `kind` that at least one device has.                                                                                                                                                         |
| `metric`       | Required. A metric that kind reports.                                                                                                                                                                    |
| `direction`    | `above` or `below`: which side of `raise` is a breach.                                                                                                                                                   |
| `raise`        | A reading **strictly beyond** this counts as a breach.                                                                                                                                                   |
| `clear`        | An open alert clears when a reading is **strictly back past** this. Must be on the safe side of `raise` (≤ for `above`, ≥ for `below`).                                                                  |
| `for`          | Positive integer: consecutive breaching readings needed to open the alert.                                                                                                                               |
| `severity`     | `low`, `medium`, `high` or `critical`.                                                                                                                                                                   |
| `incidentType` | Incident type used in the command center. Must be one the `technician` role can resolve (Facilities or Environment) — see [system-context.md](system-context.md#22-pipeline--command-center-rest--oidc). |
| `title`        | Required. Becomes the incident title.                                                                                                                                                                    |

Behaviour worth knowing:

- Between `clear` and `raise` an open alert stays open: it clears only once a reading is back past
  `clear`. That band is what prevents flapping.
- While the alert is closed, any reading that is not a breach resets the breach streak to zero, so
  `for` readings must breach _in a row_.
- The breach streak lives in memory. A restart, or a device moving to another replica, resets it;
  an alert then opens a few readings later. The _open/closed_ state is recovered from the database.
- `for` counts readings, not time. Choose it with the device's reporting interval in mind (3
  readings at one every 2 s is 6 s; at one every 5 minutes it is 15 minutes).

Rules are loaded at boot; changing them means restarting or rolling the replicas.

## Changing configuration in each environment

| Environment    | Where the values live                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local (`pnpm`) | `apps/ingest/.env` copied from [`.env.example`](../apps/ingest/.env.example); `.env` is git-ignored                                                                      |
| Compose        | `environment:` in [`docker-compose.yml`](../docker-compose.yml); `OCC_*` pass through from your shell                                                                    |
| Kubernetes     | ConfigMap `telemetry-ingest-env` (plain), Secret `telemetry-ingest-secrets` (`DATABASE_URL`, credentials), ConfigMap `telemetry-registry` (`devices.json`, `rules.json`) |
| AWS            | ECS task definition from platform-aws; secrets from Secrets Manager. No environment variable holds a secret.                                                             |

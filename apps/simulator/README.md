# @itp/simulator

Synthetic devices for the pipeline: it publishes realistic telemetry for the devices in
`apps/ingest/config/devices.json`, with scripted anomalies to trigger alerts, and a benchmark mode
that measures throughput end to end. Plain Node 24 running `.ts` files natively: no build step.

## Run it

From the repository root, once:

```bash
pnpm install
cp apps/simulator/.env.example apps/simulator/.env    # this app's settings
cp .env.example .env                                  # shared Compose ports
pnpm docker:up                                        # PostgreSQL + Mosquitto
```

Start the ingest service ([its README](../ingest/README.md)), then:

```bash
pnpm --filter @itp/simulator start -- --scenario server-room-overheat
```

| Option                  | Meaning                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `--broker <url>`        | MQTT broker (default `MQTT_URL`, else `mqtt://localhost:1883`)                                           |
| `--registry <path>`     | `devices.json` to simulate (default the ingest service's)                                                |
| `--interval <ms>`       | Publish interval per device (default 2000); above 0                                                      |
| `--anomaly <spec>`      | `device:metric:value:startAt:duration`, repeatable, e.g. `dc-env-01:temperature_c:29.5:20:60`            |
| `--scenario <name>`     | Preset anomalies: `server-room-overheat`, `crowded-lecture`                                              |
| `--duration <s>`        | Stop after this many seconds (default: until Ctrl+C)                                                     |
| `--control-host <addr>` | Control server address (default `CONTROL_HOST`, else `127.0.0.1`); see [Control server](#control-server) |
| `--control-port <port>` | Control server port (default `CONTROL_PORT`, else `3200`)                                                |
| `--ingest-url <url>`    | Ingest the control server reads (default `INGEST_URL`, else `http://localhost:3100`)                     |
| `--no-control`          | Run without the control server, as a plain publisher                                                     |

`server-room-overheat` opens the "Server room temperature high" alert about 25 s in and clears it
about a minute later.

## Control server

`start` also runs the control plane of Simulator Studio ([ADR-0011](../../docs/adr/0011-simulator-studio-control-plane.md))
in the same process: an HTTP server with JSON commands, one server-sent-events stream, and a poller
that reads what ingest did with the traffic. It is on by default; `--no-control` runs the plain
publisher, and `bench` never starts it. Ingest is not modified.

```bash
pnpm --filter @itp/simulator start                       # control server on http://127.0.0.1:3200
curl -s localhost:3200/api/state                         # engine, devices, ingest, alerts, metrics
curl -N localhost:3200/api/stream                        # the event stream; Ctrl+C to leave
curl -s -X POST -H 'Content-Type: application/json' -d '{}' \
  localhost:3200/api/scenarios/server-room-overheat/run  # starts the preset from now
```

**Safe by default.** The API has no authentication (V1 demo; see the
[security posture](../../docs/operations.md#security-posture)), so it listens on loopback only.
`CONTROL_HOST` must be `localhost`, a `127.x.y.z` address or `::1`; anything else (`0.0.0.0`, a LAN
address, a name) is refused with a message, before the broker is contacted, unless
`CONTROL_ALLOW_NON_LOOPBACK=true` is set. A web page open in your browser cannot drive it either:
no CORS header is ever sent, every `POST`, `PUT` and `DELETE` must be `Content-Type: application/json`
(`415` otherwise), and the `Host` header must be `localhost`, `127.0.0.1`, `[::1]` or the bound
address (`403` otherwise). A body is at most 16 KiB (`413`).

**Routes.** Errors use ingest's envelope (`statusCode`, `error`, `message`). A command answers with
the state, as `GET /api/state` returns it.

| Method and path                                       | What it does                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/state`                                      | Engine snapshot, devices as loaded, scenario names, ingest, alerts, metrics, config                                |
| `GET /api/stream`                                     | The event stream (below); at most 20 clients, then `503`                                                           |
| `GET /api/observations?before=&limit=`                | The observation store, newest first, `limit` 1 to 500 (default 100); `X-Next-Cursor` holds the next `before`       |
| `POST /api/devices/:id/start`, `/pause`, `/stop`      | Device state; `404` for an unknown device                                                                          |
| `PUT /api/devices/:id/interval`                       | `{ "intervalMs": 500 }`, or `null` for the engine's interval                                                       |
| `PUT /api/devices/:id/holds/:metric`                  | `{ "value": 31.5 }`: publish exactly that until released; `DELETE` on the same path releases it                    |
| `GET /api/anomalies`, `POST /api/anomalies`           | List; add `{ deviceId, metric, value, duration, shape?, startAt?, startIn? }` (`startIn`: seconds from now; `201`) |
| `DELETE /api/anomalies/:id`                           | Remove one                                                                                                         |
| `GET /api/scenarios`, `POST /api/scenarios/:name/run` | The presets of `--scenario`; run one so that its "20 s in" is 20 s from now (all of its anomalies, or none)        |
| `POST /api/reset`                                     | Clear anomalies and held values, restart the anomaly clock                                                         |
| `POST /api/step`                                      | One publish interval on the simulated clock; `409` on the wall clock, which is what `start` uses                   |

**The stream.** Every message is `event: <name>` and `data: <json>`. The first one is `snapshot`
(the state, plus `publishLog`: the last 200 published messages), so a page opened mid-demo is not
empty; after a disconnect a client reconnects and gets a new snapshot. Then: `state` (an engine
change), `published` (a message the broker accepted), `tick-error`, `ingest` (the state of ingest
changed), `alerts` (the alerts as Studio saw them), `metrics` (a read of `/metrics`) and
`observation` (an entry of the observation store).

**What it reads from ingest**, about once a second, each request with an 800 ms timeout:
`GET /api/ready`, `GET /api/alerts?limit=100` and `GET /metrics` (eight `telemetry_*` and `alert*`
series, listed in `src/prometheus-text.ts`). `/api/ready` decides the state: `ready`, `not-ready`
(a `503` is an answer: it says whether the database or the broker is down) or `unreachable`, on the
first poll that fails; the change is one event and one log line, not one per poll. If only the alerts
or the metrics fail, the last data stays and is marked `stale`.

**Observed times.** `/api/alerts` has no delivery timestamp, so Studio records when it first _saw_
an alert open or clear, its delivery become `delivered` and an incident id appear, within one poll
of the truth. Alerts already in ingest when the simulator started are listed as `preexisting`, with
no observed times. The store keeps the last 5,000 observations of the session in memory (state
changes, alerts, deliveries, incidents, ingest changes; not published messages).

## Benchmark

```bash
pnpm --filter @itp/simulator bench -- --messages 100000
```

Publishes the messages as fast as the broker accepts them, then waits until every reading is in
PostgreSQL, and prints throughput. It needs the ingest service running and the database reachable
(`DATABASE_URL`, or `--database`). Results and method: [benchmarks](../../docs/benchmarks.md).
`src/gap-report.ts` accounts for every message of a run; it is driven by `pnpm bench:gaps`, which
starts two ingest replicas of its own.

## Configuration

`apps/simulator/.env`, copied from [.env.example](.env.example), loaded by `start` and `bench`
(`node --env-file-if-exists`). Command-line options override it, and the real environment wins over
the file.

| Variable                     | Default                                                 | Used by          |
| ---------------------------- | ------------------------------------------------------- | ---------------- |
| `MQTT_URL`                   | `mqtt://localhost:1883`                                 | `start`, `bench` |
| `DATABASE_URL`               | `postgres://postgres:postgres@localhost:5433/telemetry` | `bench`          |
| `CONTROL_HOST`               | `127.0.0.1`                                             | `start`          |
| `CONTROL_PORT`               | `3200`                                                  | `start`          |
| `INGEST_URL`                 | `http://localhost:3100`                                 | `start`          |
| `OCC_CONSOLE_URL`            | empty (no incident link)                                | `start`          |
| `CONTROL_ALLOW_NON_LOOPBACK` | unset; only the exact value `true` allows               | `start`          |

`OCC_CONSOLE_URL` is the base URL of the command center console; the control server carries it to
the UI, which builds the incident link from it (the plain id is shown without it). An empty value
in the file counts as not set.

If you moved a Compose port in the root `.env`, use the same port here.

## Scripts

Run from the repository root.

| Command                                           | What it does                                |
| ------------------------------------------------- | ------------------------------------------- |
| `pnpm test:simulator`                             | Unit tests (`node --test`, `src/*.test.ts`) |
| `pnpm --filter @itp/simulator lint` / `typecheck` | ESLint, `tsc --noEmit`                      |

## Layout

```
src/
  main.ts            command line: arguments, broker connection, shutdown; runs the engine
  bench.ts           throughput benchmark
  gap-report.ts      accounts for every message of a benchmark run
  engine.ts          the publish loop: devices, anomalies, held values, Step and Reset, events
  clock.ts           the engine's time: the system clock, and a manual clock for tests and Step
  device-source.ts   where devices come from (today the ingest registry, devices.json)
  scenarios.ts       the presets behind --scenario
  signals.ts         per-device-kind baselines, daily curves and anomaly shapes (step, ramp, spike)
  random.ts          a seeded random source for reproducible readings
  control-config.ts  the control server's settings, and the loopback rule
  control-server.ts  the HTTP server: guards, routes, the event stream, the 200-message publish log
  control-routes.ts  the commands and reads, as a function from request to response (no socket)
  event-stream.ts    server-sent-events fan-out that cannot throw into the engine
  ingest-poller.ts   reads ingest's /api/ready, /api/alerts and /metrics about once a second
  alert-observer.ts  turns those reads into the times Studio first saw things happen
  observation-store.ts  the last 5,000 observations of the session, and a ring buffer
  prometheus-text.ts parses the /metrics text and keeps the series Studio forwards
  test-support.ts    fakes shared by the control server's tests (not a test itself)
  *.test.ts          next to the code they test
```

`main.ts` is a thin caller of the engine and, unless `--no-control`, of the control server. The engine has no process or argument handling, so
something else can drive it while it runs: it starts, pauses and stops devices, changes their
interval, adds and removes anomalies, holds a value, and emits an event for every change and every
message. On a manual clock time moves only when it is stepped, which makes a run reproducible.
Anomaly shapes other than a step are for the engine's callers (the control server's anomaly route
takes `shape`); `--anomaly` still takes the five fields and means a step.

A new device kind or metric needs a baseline in `src/signals.ts`; see the
[development guide](../../docs/development.md).

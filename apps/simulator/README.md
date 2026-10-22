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
pnpm --filter @itp/simulator start --scenario server-room-overheat
```

| Option                   | Meaning                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--broker <url>`         | MQTT broker (default `MQTT_URL`, else `mqtt://localhost:1883`)                                                                                                           |
| `--registry <path>`      | `devices.json` to simulate (default the ingest service's)                                                                                                                |
| `--interval <ms>`        | Publish interval per device (default 2000); above 0                                                                                                                      |
| `--anomaly <spec>`       | `device:metric:value:startAt:duration[:shape]`, repeatable; `shape` is `step` (the default), `ramp` or `spike`, e.g. `dc-env-01:temperature_c:29.5:20:60` or `…:60:ramp` |
| `--scenario <name>`      | Play a scenario from the start: the built-ins `server-room-overheat`, `crowded-lecture`, or a custom one of the folder                                                   |
| `--duration <s>`         | Stop after this many seconds (default: until Ctrl+C)                                                                                                                     |
| `--control-host <addr>`  | Control server address (default `CONTROL_HOST`, else `127.0.0.1`); see [Control server](#control-server)                                                                 |
| `--control-port <port>`  | Control server port (default `CONTROL_PORT`, else `3200`)                                                                                                                |
| `--ingest-url <url>`     | Ingest the control server reads (default `INGEST_URL`, else `http://localhost:3100`)                                                                                     |
| `--studio-dir <path>`    | Directory with the built Studio UI to serve at `/` (default `STUDIO_DIR`, else `apps/simulator-ui/dist`)                                                                 |
| `--rules <path>`         | `rules.json` that Studio draws the raise and clear lines from (default `RULES_FILE`, else the ingest service's)                                                          |
| `--scenarios-dir <path>` | Folder of custom scenario files, read once at start and written by saves (default `SCENARIOS_DIR`, else `apps/simulator/scenarios`)                                      |
| `--no-control`           | Run without the control server, as a plain publisher                                                                                                                     |
| `--simulated-clock`      | Run on the simulated clock: one tick at start, then only when Studio steps it (same as `SIMULATED_CLOCK=true`); see [Control server](#control-server)                    |

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

| Method and path                                  | What it does                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/state`                                 | Engine snapshot, devices as loaded, scenario names, ingest, alerts, metrics, rules, profiles, config                                                                                                                                                                                                                                                          |
| `GET /api/stream`                                | The event stream (below); at most 20 clients, then `503`                                                                                                                                                                                                                                                                                                      |
| `GET /api/observations?before=&limit=`           | The observation store, newest first, `limit` 1 to 500 (default 100); `X-Next-Cursor` holds the next `before`                                                                                                                                                                                                                                                  |
| `GET /api/alerts?status=&limit=&before=`         | A page of ingest's alerts, newest first, with what Studio saw and the scenario that caused each (below); `X-Next-Cursor` as ingest sends it                                                                                                                                                                                                                   |
| `POST /api/devices/:id/start`, `/pause`, `/stop` | Device state; `404` for an unknown device                                                                                                                                                                                                                                                                                                                     |
| `PUT /api/devices/:id/interval`                  | `{ "intervalMs": 500 }`, or `null` for the engine's interval                                                                                                                                                                                                                                                                                                  |
| `PUT /api/devices/:id/holds/:metric`             | `{ "value": 31.5 }`: publish exactly that until released; `DELETE` on the same path releases it                                                                                                                                                                                                                                                               |
| `GET /api/anomalies`, `POST /api/anomalies`      | List; add `{ deviceId, metric, value, duration, shape?, startAt?, startIn? }` (`startIn`: seconds from now; `201`)                                                                                                                                                                                                                                            |
| `DELETE /api/anomalies/:id`                      | Remove one                                                                                                                                                                                                                                                                                                                                                    |
| `GET /api/scenarios`                             | The scenario library with what a card needs: the document, `needsStart`, `lastRunAt`, `running`, the `expected` alerts; `rejected` files (below)                                                                                                                                                                                                              |
| `POST /api/scenarios/:name/run`                  | Run it so that its "20 s in" is 20 s from now (all of its anomalies, or none); `{ "replace": true }` takes what is in the way out first; `409` with `conflicts` otherwise                                                                                                                                                                                     |
| `POST /api/scenarios/:name/stop`                 | Stop the run: remove its anomalies; `409` when it is not running                                                                                                                                                                                                                                                                                              |
| `POST /api/scenarios/import`                     | The body is a scenario document; validated like a file and kept for this session only (`201`; `400` with the reason; `409` for a taken name)                                                                                                                                                                                                                  |
| `PUT /api/scenarios/:name`                       | Save a custom scenario as `<name>.json` in `SCENARIOS_DIR`: the body is the document and its `name` must be the path's (`201` new, `200` replaced, including an import that becomes a file; `400` with the reason; `409` for a built-in, a running scenario, the 201st, or a file in the folder that was not loaded; `500` when the folder cannot be written) |
| `DELETE /api/scenarios/:name`                    | Remove a custom scenario and its file (`200`; `404` unknown; `409` for a built-in or a running scenario; `500` when the file cannot be removed)                                                                                                                                                                                                               |
| `POST /api/expectations`                         | Read-only: `{ anomalies }` (the fields of a scenario's anomaly, `startAt` in seconds from now, 1 to 100 of them) answers `{ expected, needsStart, intervalMs }` as a library item would; `400` with the reason                                                                                                                                                |
| `POST /api/reset`                                | Clear anomalies and held values, restart the anomaly clock                                                                                                                                                                                                                                                                                                    |
| `POST /api/step`                                 | One publish interval on the simulated clock; `409` on the wall clock, the default (start with `--simulated-clock` to step)                                                                                                                                                                                                                                    |

**Running on the simulated clock.** By default the engine runs on the wall clock and publishes by itself, so `POST /api/step` answers `409`. To step it by hand,
start with `--simulated-clock` (or `SIMULATED_CLOCK=true`, exactly that value, in `.env` or the environment):

```bash
pnpm --filter @itp/simulator start --simulated-clock
curl -s -X POST localhost:3200/api/step                  # one publish interval; the tick that falls due is sent
curl -s -X POST localhost:3200/api/reset                 # clear anomalies and held values, restart the anomaly clock
```

- One tick is sent at start. After that **nothing is published until a step**: the message rate is 0 by design, and a
  scenario's time, the daily curve of the signals and every `ts` follow the simulated clock, which starts at the wall time of
  the process start.
- **Stepping far ahead of real time is not guarded.** Each step moves `ts` one interval ahead; ingest rejects a `ts` more
  than 5 minutes ahead of its own clock (`future`, see [the contract](../../docs/telemetry-contract.md)), which shows in
  `telemetry_rejections_total`. 150 steps of 2 s is 5 minutes.
- An alert raised this way has no `cause` (its time is not wall time), and observation times stay wall time.
- It needs the control server, the only way to step: with `--no-control` the flag is refused at start. The flag only turns the
  mode on; to go back to the wall clock unset `SIMULATED_CLOCK`. `bench`, the image and the Compose `demo` profile keep the wall clock.

**The stream.** Every message is `event: <name>` and `data: <json>`. The first one is `snapshot`
(the state, plus `publishLog`: the last 200 published messages), so a page opened mid-demo is not
empty; after a disconnect a client reconnects and gets a new snapshot. Then: `state` (an engine
change), `published` (a message the broker accepted), `tick-error`, `ingest` (the state of ingest
changed), `alerts` (the alerts as Studio saw them), `metrics` (a read of `/metrics`) and
`observation` (an entry of the observation store).

**Studio's files.** The same server serves the built UI of Simulator Studio (`apps/simulator-ui`; the package arrives with the next
parts of SIM-04): `GET` and `HEAD` for anything outside `/api/`. A path with a file extension is a file (`404` when it is not one, never the app's page);
any other path is a route of the single-page app and gets `index.html`, so a reload on `/fleet` works. Files under
`/assets/` are named by content hash and cached for good; `index.html` is revalidated. HTML carries a
Content-Security-Policy (everything from this origin, nothing inline, no framing), and nothing outside the directory
can be read (`..` in any spelling, dotfiles, a symlink that leaves it). If the directory is not built the API works
as before, the start-up output says `Studio UI: not built`, and `GET /` answers with how to build it.

**The broker.** `GET /api/state` has `broker`: the simulator's own connection to the MQTT broker as
`{ url, port, connected }`, with the credentials, path and query of `--broker` / `MQTT_URL` left out. A change is
announced on the stream as a `broker` event.

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

**Paging alerts.** The browser cannot reach ingest (the Content-Security-Policy allows only this origin and
no CORS header is sent), so `GET /api/alerts` asks ingest for one page and answers with it: `status` (`open` or
`cleared`), `limit` (1 to 200) and `before` go to ingest as they are, `before` URL-encoded and otherwise unread.
It must be a value taken from a previous `X-Next-Cursor`, which is passed back to the caller unchanged and is
absent on the last page; Studio never builds one. The body is ingest's array, newest first, and each alert also
has `preexisting` and `observed` (as in the state, empty for an alert Studio never tracked) and `cause`. A
request ingest refuses (an older replica that does not know `limit` or `before`, a cursor it did not issue) is a
`400` with its message; ingest not answering in 3 s, answering with another status, or answering with
something that is not the documented array is a `502`. It does not change the poll or the state.

**The cause of an alert.** `POST /api/scenarios/:name/run` records, in its `scenario-run` observation, the
anomalies it added (`id`, `deviceId`, `metric`, `startAt`, `duration`), so that they outlive a reset of the
engine. An alert has `cause: { scenario, startedAt }` when such a run added an anomaly on the alert's device
and metric and the alert opened from when that anomaly started until 30 s after it ended (the newest run
wins); otherwise `cause` is `null`. It is a match by device, metric and time, not a proof: a hand-added
anomaly on the same metric inside a run's window would be taken for the run's. An alert raised by the CLI's
`--scenario` or by anything else has no cause, and an engine on the simulated clock never claims one (its
time is not wall time).

**Scenarios.** A scenario is a plain JSON document, the same for a built-in, a file and an import:

```json
{
  "name": "server-room-overheat",
  "description": "Row A runs hot for a minute, then recovers.",
  "anomalies": [
    {
      "deviceId": "dc-env-01",
      "metric": "temperature_c",
      "value": 29.2,
      "startAt": 20,
      "duration": 60
    }
  ]
}
```

Times are seconds from the start of the scenario; `shape` (`step`, the default, `ramp` or `spike`) is optional. Every document can
be played from the command line: `--anomaly` takes the same fields (`device:metric:value:startAt:duration[:shape]`), so the
anomalies above are `--anomaly dc-env-01:temperature_c:29.2:20:60`. A document is refused, with the
field named, when: the name is not 1 to 64 characters of lower-case letters, digits and hyphens (or is `import`); the
description is over 200 characters; there are not 1 to 50 anomalies; a field is unknown; a device is not in the registry in
use or does not report the metric; a `value` is outside the range of the telemetry contract for its metric; `startAt` is
negative or `duration` is not above 0 and at most 3,600 s; or two anomalies play at once on one device and metric (the engine plays
only the first). The built-ins are in `scenarios.ts`. Custom ones are `*.json` files (at most 16 KiB each, at most 200 in all,
imports counted) in `SCENARIOS_DIR`, read once at start and only when the control server runs; a missing folder means none, and
a file that cannot be used is listed in `rejected` and in the start-up output with its reason, never played and never fatal. An
import is kept in memory until the process ends and writes nothing.

**Saving one.** `PUT /api/scenarios/:name` validates the document as above and writes `<name>.json` (or, for a scenario that was read from a
file with another name, that file, so one name is never in two files) in `SCENARIOS_DIR`: two-space JSON with a fixed key order, written to a
temporary file and renamed, so a restart never reads half a file. The folder is created when it is missing. Only custom scenarios
can be changed or removed, and not while they run (stop them first); a built-in answers `409`. A new scenario never overwrites a file of that
name that was not loaded (a file listed in `rejected`, or one that holds another scenario): that is `409`. A file edited by hand is not
seen until the simulator restarts. The folder is outside `src/`, so the container image does not have it and a read-only root filesystem
cannot write to it: mount a writable volume on `SCENARIOS_DIR` to save custom scenarios under Compose or Kubernetes, or the save
answers `500` with the reason and nothing is kept in memory. A save or a delete is not an observation.

**Running one.** A run adds the scenario's anomalies "from now" and starts every device it needs that is stopped or paused
(`startedDevices`); `GET /api/scenarios` lists them beforehand as `needsStart`. A scenario never plays over another anomaly: if an
anomaly, active or still to come, is on a device it uses, whoever started it (another run, `--scenario`, a hand-added fault), the
run is refused with `409` and the `conflicts`, unless the body has `"replace": true`, which stops the whole conflicting run
(a scenario cut in half is not the scenario) and removes a loose anomaly alone. Running the same scenario again is a replace.
A stop removes the run's anomalies and leaves the devices it started running; an open alert then clears by itself. A run ends by
itself when the anomaly clock passes the end of its last anomaly, or when a reset or a `DELETE` removes its anomalies; `runs` in the
state lists those still playing, and `scenario-run` and `scenario-stop` observations record what was done.

**The expected alerts.** For each anomaly and each rule that watches its device kind and metric, `expected` gives the second, from the
scenario start, at which the alert should open (the `for`-th consecutive reading beyond the raise line) and clear (the first
reading back past the clear line, at or after the end of the anomaly, or earlier for a `spike`), worked out on the publish ticks with the
noise-free signal. They are a best case, stated to **within one publish interval** (2 s by default): a device that is already
running publishes on the engine's own grid, which is not aligned with the click, so the real alert can be up to one interval later.
`opensMargin` marks a reading within the ±0.1 jitter of the raise line, which may open it later or never. `clearsUncertain` marks a
clear whose baseline is within the noise of the clear line (CO₂ and power near their daily peak): it may take longer, and `clearsAtS: null`
means no reading came back past the line within ten ticks. An anomaly that no rule watches, or that never crosses its line, is in
`quiet`. If the rules file could not be read, `expected` is `{ available: false, reason }`: there is no guess. The numbers say nothing of
an alert that is already open when the run starts, and they assume the rules the simulator read are the ones ingest runs.

**Previewing a fault.** `POST /api/expectations` works out the same `expected` for anomalies that are in no scenario, which is what the
Lab shows before a fault is injected. It is a `POST` because the body is a list, and it changes nothing: no anomaly is added, no
scenario is kept, nothing is recorded. The anomalies are checked as a scenario file's are (device, metric, the contract's range,
`duration` up to 3,600 s, no two overlapping on one device and metric), except that it takes up to 100 instead of 50; a body is at most
16 KiB (`413`), about 100 anomalies with short device ids. Times, in the request and in the answer, are seconds from now. It sees only the
anomalies of the request, not the ones the engine already plays, so a caller that injects checks `GET /api/anomalies` for an overlap. A
device that is not running is in `needsStart` and the times assume it starts with the fault, as a run would start it; injecting an anomaly
does **not** start a device, so on a stopped one nothing would ever be published. When the walk would need more than 20,000 readings in all
(signals × seconds ÷ interval), `expected` is `{ available: false, reason }` rather than an answer that holds up the publishing tick.

## A registry of 100 devices

[fixtures/devices-100/](fixtures/devices-100/) holds a `devices.json` of 100 devices in 20 zones and a copy of ingest's `rules.json`, for
checking the Lab at scale (the zone list above 60 devices, a fault on 12 of them). It is generated by
[scripts/gen-registry-100.mjs](../../scripts/gen-registry-100.mjs) (`node scripts/gen-registry-100.mjs`), committed, and checked against the
script and against ingest's `rules.json` by `scripts/gen-registry-100.test.mjs` and `src/registry-100.test.ts`. It keeps the six devices
of ingest's registry, so the built-in scenarios still run. **Ingest must read the same directory** (`CONFIG_DIR`), or it rejects the other 94
devices as `unknown_device`; how, and what that leaves in the database, is in
[docs/development.md](../../docs/development.md#the-100-device-registry).

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

| Variable                     | Default                                                  | Used by          |
| ---------------------------- | -------------------------------------------------------- | ---------------- |
| `MQTT_URL`                   | `mqtt://localhost:1883`                                  | `start`, `bench` |
| `DATABASE_URL`               | `postgres://postgres:postgres@localhost:5433/telemetry`  | `bench`          |
| `CONTROL_HOST`               | `127.0.0.1`                                              | `start`          |
| `CONTROL_PORT`               | `3200`                                                   | `start`          |
| `INGEST_URL`                 | `http://localhost:3100`                                  | `start`          |
| `OCC_CONSOLE_URL`            | empty (no incident link)                                 | `start`          |
| `CONTROL_ALLOW_NON_LOOPBACK` | unset; only the exact value `true` allows                | `start`          |
| `STUDIO_DIR`                 | `apps/simulator-ui/dist`                                 | `start`          |
| `RULES_FILE`                 | `apps/ingest/config/rules.json`                          | `start`          |
| `SCENARIOS_DIR`              | `apps/simulator/scenarios` (absent: no custom scenarios) | `start`          |
| `SIMULATED_CLOCK`            | unset; only the exact value `true` turns it on           | `start`          |

`OCC_CONSOLE_URL` is the base URL of the command center console; the control server carries it to
the UI, which builds the incident link from it (the plain id is shown without it). An empty value
in the file counts as not set. `STUDIO_DIR` is the directory of the built UI; a relative path is taken from where
the simulator was started, and a directory that is not built is not an error (see above).

`RULES_FILE` (or `--rules`) is the ingest's `rules.json`. The simulator reads it once at start, checks it with
the same rules as ingest ([rules-source.ts](src/rules-source.ts)) and reports it in the `rules` part of
`GET /api/state`: `{ available, reason, items }`, where `items` carries each rule's metric, direction, `raise`,
`clear`, `for`, severity and title. A file that is missing or invalid does not stop the simulator: `available` is
`false`, `reason` says why, and Studio hides what depends on the rules. The `profiles` part of the state gives,
for each device and metric, the baseline, the noise (±) and the daily swing the generator uses
([signals.ts](src/signals.ts)); they are read-only. The demo image copies `rules.json` next to `devices.json`.

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
  scenarios.ts       the built-in scenarios, as documents
  scenario-document.ts   the scenario document: its limits, its validation, the --anomaly flag for it
  scenario-library.ts    the built-ins, the folder of custom files and the imports, by name; save and remove
  scenario-store.ts      the only code that writes scenario files: atomic, size-checked, never over a file it did not load
  scenario-expectations.ts  the alerts a scenario should raise and when, from the rules and the interval
  scenario-runs.ts   the scenarios Studio started: run, replace, stop, and which are still playing
  signals.ts         per-device-kind baselines, daily curves and anomaly shapes (step, ramp, spike)
  random.ts          a seeded random source for reproducible readings
  control-config.ts  the control server's settings, and the loopback rule
  control-server.ts  the HTTP server: guards, routes, the event stream, the 200-message publish log
  control-routes.ts  the commands and reads, as a function from request to response (no socket)
  event-stream.ts    server-sent-events fan-out that cannot throw into the engine
  ingest-poller.ts   reads ingest's /api/ready, /api/alerts and /metrics about once a second
  alert-observer.ts  turns those reads into the times Studio first saw things happen
  alert-cause.ts     the scenario Studio started that an alert came from, worked out from the runs (or none)
  observation-store.ts  the last 5,000 observations of the session, and a ring buffer
  prometheus-text.ts parses the /metrics text and keeps the series Studio forwards
  static-files.ts    resolves a request to a file of the built UI: routes, assets, cache and policy headers
  broker-link.ts     whether the simulator is connected to the MQTT broker, as the control server reports it
  test-support.ts    fakes shared by the control server's tests (not a test itself)
  *.test.ts          next to the code they test
```

`main.ts` is a thin caller of the engine and, unless `--no-control`, of the control server. The engine has no process or argument handling, so
something else can drive it while it runs: it starts, pauses and stops devices, changes their
interval, adds and removes anomalies, holds a value, and emits an event for every change and every
message. On a manual clock time moves only when it is stepped, which makes a run reproducible.
Anomaly shapes other than a step are for the engine's callers (the control server's anomaly route
takes `shape`); `--anomaly` takes it as an optional sixth field and means a step without it.

A new device kind or metric needs a baseline in `src/signals.ts`; see the
[development guide](../../docs/development.md).

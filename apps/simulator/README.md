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

| Option              | Meaning                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `--broker <url>`    | MQTT broker (default `MQTT_URL`, else `mqtt://localhost:1883`)                                |
| `--registry <path>` | `devices.json` to simulate (default the ingest service's)                                     |
| `--interval <ms>`   | Publish interval per device (default 2000)                                                    |
| `--anomaly <spec>`  | `device:metric:value:startAt:duration`, repeatable, e.g. `dc-env-01:temperature_c:29.5:20:60` |
| `--scenario <name>` | Preset anomalies: `server-room-overheat`, `crowded-lecture`                                   |
| `--duration <s>`    | Stop after this many seconds (default: until Ctrl+C)                                          |

`server-room-overheat` opens the "Server room temperature high" alert about 25 s in and clears it
about a minute later.

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

| Variable       | Default                                                 | Used by          |
| -------------- | ------------------------------------------------------- | ---------------- |
| `MQTT_URL`     | `mqtt://localhost:1883`                                 | `start`, `bench` |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5433/telemetry` | `bench`          |

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
  main.ts          publishes continuously (scenarios, anomalies)
  bench.ts         throughput benchmark
  gap-report.ts    accounts for every message of a benchmark run
  signals.ts       per-device-kind baselines, daily curves and anomalies
  signals.test.ts
```

A new device kind or metric needs a baseline in `src/signals.ts`; see the
[development guide](../../docs/development.md).

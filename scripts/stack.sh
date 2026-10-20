#!/usr/bin/env bash
# The PostgreSQL and Mosquitto that local development and the e2e suite share (docker-compose.yml).
#
#   scripts/stack.sh up        start them (waits until ready) and make sure `telemetry_test` exists
#   scripts/stack.sh demo      the whole demo in containers: also builds and starts the ingest
#                              service and a simulator (foreground; Ctrl+C stops it); Simulator
#                              Studio is then at http://localhost:$STUDIO_HOST_PORT (3200)
#   scripts/stack.sh demo-down stop and remove only the demo's ingest and simulator containers;
#                              PostgreSQL and Mosquitto keep running
#   scripts/stack.sh observe   start Prometheus and Grafana (profile `observe`, detached) on the shipped
#                              rules and dashboard; demo only. Prometheus scrapes the ingest service of
#                              this project, so run `demo` (or an ingest of the project) as well
#   scripts/stack.sh observe-down  stop and remove only those two containers
#   scripts/stack.sh down      stop and remove every container of the Compose project, demo and observe
#                              included; the database volume is kept
#   scripts/stack.sh restart   down, then up
#
# Host ports come from POSTGRES_HOST_PORT / MQTT_HOST_PORT / STUDIO_HOST_PORT (and, for `observe`,
# PROMETHEUS_HOST_PORT / GRAFANA_HOST_PORT) in `.env` (see .env.example).
set -euo pipefail

cd "$(dirname "$0")/.."

up() {
  docker compose up -d --wait postgres mosquitto

  # The e2e suite wipes the `public` schema of its database (V1-T03), so it gets its own database
  # inside this PostgreSQL: the `telemetry` database used for development is never touched.
  local psql=(docker compose exec -T postgres psql -U postgres -d telemetry)
  local exists
  exists="$("${psql[@]}" -tAc "SELECT 1 FROM pg_database WHERE datname = 'telemetry_test'")"
  [ "$exists" = 1 ] || "${psql[@]}" -c "CREATE DATABASE telemetry_test"
}

demo() {
  # `up` stays in the foreground and prints container logs, so say where Studio is before it starts.
  # The port is the one Compose will publish: STUDIO_HOST_PORT from the environment or the root `.env`.
  local port="${STUDIO_HOST_PORT:-}"
  if [ -z "$port" ] && [ -f .env ]; then
    port="$(sed -n 's/^STUDIO_HOST_PORT=//p' .env | tail -n 1)"
  fi
  echo "Simulator Studio will be at http://localhost:${port:-3200} once the simulator is up"
  docker compose --profile demo up --build
}

demo_down() {
  docker compose --profile demo rm -sf ingest simulator
}

observe() {
  docker compose --profile observe up -d prometheus grafana
}

observe_down() {
  docker compose --profile observe rm -sf prometheus grafana
}

down() {
  docker compose --profile '*' down
}

case "${1:-}" in
  up) up ;;
  demo) demo ;;
  demo-down) demo_down ;;
  observe) observe ;;
  observe-down) observe_down ;;
  down) down ;;
  restart) down && up ;;
  *) echo "usage: $0 up|demo|demo-down|observe|observe-down|down|restart" >&2; exit 2 ;;
esac

#!/usr/bin/env bash
# The PostgreSQL and Mosquitto that local development and the e2e suite share (docker-compose.yml).
#
#   scripts/stack.sh up        start them (waits until ready) and make sure `telemetry_test` exists
#   scripts/stack.sh demo      the whole demo in containers: also builds and starts the ingest
#                              service and a simulator (foreground; Ctrl+C stops it)
#   scripts/stack.sh demo-down stop and remove only the demo's ingest and simulator containers;
#                              PostgreSQL and Mosquitto keep running
#   scripts/stack.sh down      stop and remove every container of the Compose project, demo included;
#                              the database volume is kept
#   scripts/stack.sh restart   down, then up
#
# Host ports come from POSTGRES_HOST_PORT / MQTT_HOST_PORT in `.env` (see .env.example).
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
  docker compose --profile demo up --build
}

demo_down() {
  docker compose --profile demo rm -sf ingest simulator
}

down() {
  docker compose --profile '*' down
}

case "${1:-}" in
  up) up ;;
  demo) demo ;;
  demo-down) demo_down ;;
  down) down ;;
  restart) down && up ;;
  *) echo "usage: $0 up|demo|demo-down|down|restart" >&2; exit 2 ;;
esac

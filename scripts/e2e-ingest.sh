#!/usr/bin/env bash
# Runs the ingest e2e suite against the shared PostgreSQL and Mosquitto (scripts/stack.sh), in the
# `telemetry_test` database, so the `telemetry` database used for development is never touched.
# The suite boots the application itself. The stack is left running afterwards.
set -euo pipefail

cd "$(dirname "$0")/.."

bash scripts/stack.sh up

# Host ports as published (POSTGRES_HOST_PORT / MQTT_HOST_PORT in `.env`).
host_port() { docker compose port "$1" "$2" | sed 's/.*://'; }
pg_port="$(host_port postgres 5432)"
mqtt_port="$(host_port mosquitto 1883)"

# Builds the contract package first (turbo).
DATABASE_URL="postgres://postgres:postgres@localhost:${pg_port}/telemetry_test" \
MQTT_URL="mqtt://localhost:${mqtt_port}" \
  pnpm test:e2e

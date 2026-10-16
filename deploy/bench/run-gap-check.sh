#!/usr/bin/env bash
# V1-T01 acceptance check: two ingest replicas, one broker, one database.
#
#   deploy/bench/run-gap-check.sh ok   [messages]   no message lost  -> the gap measure stays at 0
#   deploy/bench/run-gap-check.sh loss [messages]   lossy broker     -> every lost message counted once
#
# Builds the ingest image, starts a fresh stack (volumes are wiped), publishes a burst with
# apps/simulator/src/bench.ts, then accounts for every message with apps/simulator/src/gap-report.ts.
# The stack is removed on exit. Needs Docker and Node 24 (see .nvmrc), and `pnpm build` done once.
set -euo pipefail

scenario="${1:-ok}"
messages="${2:-50000}"
root="$(cd "$(dirname "$0")/../.." && pwd)"

case "$scenario" in
  ok) export MOSQUITTO_CONF=../mosquitto/mosquitto.conf ;;
  loss) export MOSQUITTO_CONF=./mosquitto-lossy.conf ;;
  *) echo "usage: $0 ok|loss [messages]" >&2; exit 2 ;;
esac

compose=(docker compose -p itp-bench -f "$root/deploy/bench/docker-compose.replicas.yml")
trap '"${compose[@]}" down -v --remove-orphans' EXIT

"${compose[@]}" down -v --remove-orphans
"${compose[@]}" up -d --build

echo "Waiting for both replicas to be ready…"
for port in 3101 3102; do
  for _ in $(seq 1 60); do
    curl -fs "http://localhost:$port/api/ready" > /dev/null && break
    sleep 2
  done
  curl -fs "http://localhost:$port/api/ready" > /dev/null || { echo "replica on :$port not ready" >&2; exit 1; }
done

# bench.ts counts from 1 000 001 with timestamps from an hour ago: seed that as the last message
# seen, so one lost at the very start of the burst is a gap like any other.
"${compose[@]}" exec -T postgres psql -U postgres -d telemetry \
  -c "UPDATE device SET last_seq = 1000000, seq_last_ts = now() - interval '2 hours', seq_holes = '[]'"

cd "$root/apps/simulator"
# With loss, the bench waits for readings that never arrive and exits 1: keep that wait short and
# let gap-report.ts judge the outcome instead.
timeout=120
[ "$scenario" = loss ] && timeout=20
bench=(node src/bench.ts --broker mqtt://localhost:1884
  --database postgres://postgres:postgres@localhost:5434/telemetry
  --messages "$messages" --timeout "$timeout")
if [ "$scenario" = loss ]; then "${bench[@]}" || true; else "${bench[@]}"; fi

# Flushes and the grace period settle.
sleep 5
expect=none
[ "$scenario" = loss ] && expect=loss
node src/gap-report.ts --messages "$messages" --expect "$expect" \
  --metrics http://localhost:3101/metrics --metrics http://localhost:3102/metrics \
  --database postgres://postgres:postgres@localhost:5434/telemetry

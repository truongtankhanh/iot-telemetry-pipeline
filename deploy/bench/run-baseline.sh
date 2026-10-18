#!/usr/bin/env bash
# IMP-11.1: a repeatable single-replica baseline, with a CPU profile of the ingest process.
#
#   deploy/bench/run-baseline.sh [options]        (or: pnpm bench:baseline -- [options])
#
#   --messages <n>          messages per run, at most 250000         (default 100000, as docs/benchmarks.md)
#   --runs <n>              consecutive runs, each on emptied tables (default 3)
#   --connections <n>       MQTT_CONNECTIONS of the service          (default 1)
#   --pg-setting name=val   ALTER DATABASE telemetry SET name = 'val' before the service starts;
#                           repeatable (IMP-14.3 uses synchronous_commit=off)
#   --profiler <mode>       cpu-prof (default): node --cpu-prof, a .cpuprofile written at exit
#                           prof: node --prof, V8's tick log, summarised with --prof-process
#                           (fallback if a signal-ended process writes no .cpuprofile)
#   --out <dir>             where the results go (default deploy/bench/out/<UTC timestamp>)
#   --keep                  leave PostgreSQL and Mosquitto running afterwards (IMP-13.1 uses them)
#
# Starts only PostgreSQL and Mosquitto of deploy/bench/docker-compose.replicas.yml (Compose project
# itp-bench, ports :5434 and :1884, volumes wiped), runs the service ON THE HOST under the profiler
# on :3101 with a clean environment, drives it with apps/simulator/src/bench.ts, and stops it with
# SIGTERM so the profile is written. Needs Docker, curl and Node 24 (see .nvmrc), and a build first:
#   pnpm --filter @itp/telemetry-contract build && pnpm --filter @itp/ingest build
# Heavy: run it alone. It shares the project name and ports with `pnpm bench:gaps`: not together.
# Exit code: 0 only if every run stored every reading and a profile was written.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
compose=(docker compose -p itp-bench -f "$root/deploy/bench/docker-compose.replicas.yml")
export MOSQUITTO_CONF=../mosquitto/mosquitto.conf

pg_port=5434
mqtt_port=1884
ingest_port=3101
db_url="postgres://postgres:postgres@localhost:$pg_port/telemetry"
mqtt_url="mqtt://localhost:$mqtt_port"

messages=100000
runs=3
connections=1
profiler=cpu-prof
out=""
keep=0
pg_settings=()

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' >&2; }
die() { echo "run-baseline: $*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --messages) messages="${2:?--messages needs a value}"; shift 2 ;;
    --runs) runs="${2:?--runs needs a value}"; shift 2 ;;
    --connections) connections="${2:?--connections needs a value}"; shift 2 ;;
    --pg-setting) pg_settings+=("${2:?--pg-setting needs name=value}"); shift 2 ;;
    --profiler) profiler="${2:?--profiler needs cpu-prof or prof}"; shift 2 ;;
    --out) out="${2:?--out needs a directory}"; shift 2 ;;
    --keep) keep=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift ;;
    *) usage; die "unknown option: $1" ;;
  esac
done

[[ "$messages" =~ ^[1-9][0-9]*$ ]] || die "--messages must be a positive integer"
# A burst this size outruns the service: the broker queues what the service has not read yet, and
# past its max_queued_messages (200000 in deploy/mosquitto/mosquitto.conf) it drops the rest. Seen
# at 500000 (564649 of 1000000 readings stored, 0 gaps counted). bench.ts also spaces its timestamps
# 10 ms apart from an hour ago, so past ~390000 messages they are in the future and rejected.
[ "$messages" -le 250000 ] || die "--messages above 250000 loses messages in the broker queue and runs past the clock-skew limit"
[[ "$runs" =~ ^[1-9][0-9]*$ ]] || die "--runs must be a positive integer"
[[ "$connections" =~ ^[1-9][0-9]*$ ]] || die "--connections must be a positive integer"
case "$profiler" in cpu-prof|prof) ;; *) die "--profiler must be cpu-prof or prof" ;; esac
for setting in "${pg_settings[@]:-}"; do
  [ -z "$setting" ] && continue
  [[ "$setting" =~ ^[a-z_.]+=[A-Za-z0-9_.-]+$ ]] || die "--pg-setting takes name=value (letters, digits, _ . -): $setting"
done

for tool in docker curl node; do
  command -v "$tool" > /dev/null || die "$tool is required"
done
[ -f "$root/apps/ingest/dist/main.js" ] \
  || die "apps/ingest/dist/main.js is missing: build first (pnpm --filter @itp/telemetry-contract build && pnpm --filter @itp/ingest build)"
[ -f "$root/packages/telemetry-contract/dist/index.cjs" ] \
  || die "the contract is not built: pnpm --filter @itp/telemetry-contract build"
# Anything already answering on the service's port would pass the readiness wait below.
if curl -s --max-time 2 -o /dev/null "http://localhost:$ingest_port/"; then
  die "something already listens on :$ingest_port"
fi

[ -n "$out" ] || out="$root/deploy/bench/out/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out/profile"
out="$(cd "$out" && pwd)"

ingest_pid=""
sampler_pid=""
fail=0

psql() { "${compose[@]}" exec -T postgres psql -U postgres -d telemetry -v ON_ERROR_STOP=1 "$@"; }

# shellcheck disable=SC2329 # run by the EXIT trap below
cleanup() {
  local status=$?
  stop_sampler
  if [ -n "$ingest_pid" ] && kill -0 "$ingest_pid" 2> /dev/null; then
    kill -KILL "$ingest_pid" 2> /dev/null || true
  fi
  if [ "$keep" -eq 1 ]; then
    echo "Stack left running (--keep). Remove it with:" >&2
    echo "  ${compose[*]} down -v --remove-orphans" >&2
  else
    "${compose[@]}" down -v --remove-orphans > /dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT

# One stats line per container per refresh (about every second), each stamped with the epoch second.
# `docker stats --no-stream` takes longer than a short run, so the stream is read instead; the escape
# codes it prints between refreshes are stripped.
sample_stats() {
  # shellcheck disable=SC2086 # $containers is a list of ids
  docker stats --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' $containers 2> /dev/null \
    | while IFS= read -r stats_line; do
      stats_line="$(printf '%s' "$stats_line" | sed $'s/\033\\[[0-9;]*[A-Za-z]//g')"
      [ -n "$stats_line" ] && printf '%s %s\n' "$(date +%s)" "$stats_line"
    done
}
# The sampler is a pipeline in a subshell: stop its children too, or `docker stats` keeps running.
# shellcheck disable=SC2329 # also run by the EXIT trap, through cleanup
stop_sampler() {
  [ -n "$sampler_pid" ] || return 0
  pkill -P "$sampler_pid" 2> /dev/null || true
  stop_sampler
}

# Value of a metric in a /metrics scrape; labelled series of one name are added up.
metric() { awk -v n="$2" '$1 == n || index($1, n "{") == 1 { s += $NF; f = 1 } END { printf "%s", f ? s : 0 }' "$1"; }
calc() { awk "BEGIN { printf \"%s\", ($1) }"; }

echo "Output: $out"
"${compose[@]}" down -v --remove-orphans
"${compose[@]}" up -d --wait postgres mosquitto

for setting in "${pg_settings[@]:-}"; do
  [ -z "$setting" ] && continue
  psql -c "ALTER DATABASE telemetry SET ${setting%%=*} = '${setting#*=}'"
done

# --- the service, on the host, under the profiler ---------------------------------------------
# Started from the profile folder so that --prof's isolate log and --cpu-prof land there, and with
# an empty environment so that nothing from the shell (OCC_API_URL, MQTT_*) or from an .env file in
# the working directory changes what is measured. Every setting not listed is the default.
node_flags=()
case "$profiler" in
  cpu-prof) node_flags=(--cpu-prof --cpu-prof-dir="$out/profile") ;;
  prof) node_flags=(--prof) ;;
esac
service_env=(
  "PATH=$PATH" "HOME=$HOME"
  "PORT=$ingest_port" "DATABASE_URL=$db_url" "MQTT_URL=$mqtt_url"
  "MQTT_CONNECTIONS=$connections" "FLUSH_INTERVAL_MS=250" "FLUSH_MAX_READINGS=1000"
  "CONFIG_DIR=$root/apps/ingest/config"
)
(cd "$out/profile" && exec env -i "${service_env[@]}" node "${node_flags[@]}" "$root/apps/ingest/dist/main.js") \
  > "$out/ingest.log" 2>&1 &
ingest_pid=$!

echo "Waiting for the service (:$ingest_port)..."
ready=0
for _ in $(seq 1 60); do
  kill -0 "$ingest_pid" 2> /dev/null || { tail -n 20 "$out/ingest.log" >&2; die "the service exited during start-up"; }
  if curl -fs "http://localhost:$ingest_port/api/ready" > /dev/null; then ready=1; break; fi
  sleep 2
done
[ "$ready" -eq 1 ] || { tail -n 20 "$out/ingest.log" >&2; die "the service did not become ready"; }

# --- what was measured on -----------------------------------------------------------------------
{
  echo "date (UTC):       $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit:           $(git -C "$root" rev-parse --short HEAD)$([ -n "$(git -C "$root" status --porcelain -- apps packages deploy)" ] && echo ' (+ uncommitted changes)')"
  echo "node:             $(node -v)"
  echo "pnpm:             $(pnpm -v 2> /dev/null || echo 'not installed')"
  node -e "const os = require('node:os'); console.log('host:             ' + os.platform() + ' ' + os.release() + ' ' + os.arch() + ', ' + os.cpus()[0].model + ', ' + os.cpus().length + ' cores, ' + Math.round(os.totalmem() / 2 ** 30) + ' GiB')"
  echo "docker:           $(docker info --format '{{.ServerVersion}}, {{.NCPU}} CPUs, {{.MemTotal}} bytes' 2> /dev/null || echo unknown)"
  echo "images:           $(grep -E '^\s+image:' "$root/deploy/bench/docker-compose.replicas.yml" | sed 's/.*image: *//' | sort -u | paste -sd' ' -)"
  for name in server_version synchronous_commit shared_buffers max_wal_size wal_writer_delay; do
    echo "postgres $name: $(psql -tAc "SHOW $name" | tr -d '\r')"
  done
  echo "pg settings:      ${pg_settings[*]:-none}"
  echo "profiler:         $profiler"
  echo "runs x messages:  $runs x $messages"
  echo "service env:      ${service_env[*]:2}"
} > "$out/environment.txt"

# --- the runs ------------------------------------------------------------------------------------
containers="$("${compose[@]}" ps -q postgres mosquitto | tr '\n' ' ')"
: > "$out/runs.jsonl"
for run in $(seq 1 "$runs"); do
  echo "Run $run of $runs..."
  # Rows of the previous run would collide with this one's timestamps and sequence numbers.
  psql -q -c "TRUNCATE reading, rollup_1m; UPDATE device SET last_seq = NULL, seq_last_ts = NULL, seq_holes = '[]'"
  curl -fs "http://localhost:$ingest_port/metrics" > "$out/run-$run.metrics-before.txt"

  sample_stats > "$out/run-$run.docker-stats.txt" &
  sampler_pid=$!

  line="$out/run-$run.json"
  if (cd "$root/apps/simulator" && node src/bench.ts --json --broker "$mqtt_url" --database "$db_url" \
        --messages "$messages" --timeout 120) > "$line"; then
    :
  else
    echo "Run $run did not store every reading." >&2
    fail=1
  fi
  kill "$sampler_pid" 2> /dev/null || true
  wait "$sampler_pid" 2> /dev/null || true
  sampler_pid=""

  [ -s "$line" ] && cat "$line" >> "$out/runs.jsonl"
  # Flushes and rule evaluation settle before the second scrape.
  sleep 2
  curl -fs "http://localhost:$ingest_port/metrics" > "$out/run-$run.metrics-after.txt"

  before="$out/run-$run.metrics-before.txt"
  after="$out/run-$run.metrics-after.txt"
  delta() { calc "$(metric "$after" "$1") - $(metric "$before" "$1")"; }
  flushes="$(delta telemetry_flush_duration_seconds_count)"
  {
    echo "service cpu seconds:        $(delta process_cpu_seconds_total)"
    echo "flushes:                    $flushes"
    echo "readings per flush (avg):   $(calc "$flushes > 0 ? $(delta telemetry_batch_size_sum) / $flushes : 0")"
    echo "flush time ms (avg):        $(calc "$flushes > 0 ? 1000 * $(delta telemetry_flush_duration_seconds_sum) / $flushes : 0")"
    echo "flush retries:              $(delta telemetry_flush_retries_total)"
    echo "sequence gaps:              $(delta telemetry_sequence_gaps_total)"
    echo "alert transitions:          $(delta alerts_transitions_total)"
  } > "$out/run-$run.metrics-summary.txt"
  cat "$line" "$out/run-$run.metrics-summary.txt"
done

# --- stop the service: SIGTERM, as Compose and Kubernetes do, so the shutdown hooks run ------------
echo "Stopping the service..."
kill -TERM "$ingest_pid" 2> /dev/null || true
for _ in $(seq 1 40); do
  kill -0 "$ingest_pid" 2> /dev/null || break
  sleep 1
done
if kill -0 "$ingest_pid" 2> /dev/null; then
  echo "The service did not stop within 40 s; killed." >&2
  kill -KILL "$ingest_pid" 2> /dev/null || true
  fail=1
fi
wait "$ingest_pid" 2> /dev/null || true
ingest_pid=""

case "$profiler" in
  cpu-prof)
    profiles=("$out"/profile/*.cpuprofile)
    if [ -e "${profiles[0]}" ]; then
      echo "Profile: ${profiles[*]}"
    else
      echo "No .cpuprofile was written (the process ended on a signal?). Use --profiler prof." >&2
      fail=1
    fi
    ;;
  prof)
    logs=("$out"/profile/isolate-*.log)
    if [ -e "${logs[0]}" ]; then
      node --prof-process "${logs[@]}" > "$out/prof-process.txt" 2> /dev/null || true
      echo "Profile summary: $out/prof-process.txt"
    else
      echo "No isolate log was written." >&2
      fail=1
    fi
    ;;
esac

echo "Done: $out"
exit "$fail"

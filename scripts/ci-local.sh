#!/usr/bin/env bash
#
# A local stand-in for .github/workflows/ci.yml, so a PR does not wait for GitHub's runners.
#
#   verify     (job 1)  install, format:check, lint, typecheck, test, test:coverage, test:e2e, build, OpenAPI check
#   manifests  (job 2)  kustomize build of deploy/k8s/overlays/local, validated with kubeconform
#   images     (job 3)  docker compose --profile demo build
#
# It keeps CI's order and its checks; when ci.yml changes, change this file in the same PR.
# It does not run the other three workflows: security.yml (dependency audit), occ-contract.yml and
# platform-aws-contract.yml. They need the network or another repository and are separate on purpose.
# Differences, on purpose: it throttles (turbo and Jest workers; this machine has little headroom),
# and e2e runs against a throwaway PostgreSQL and Mosquitto (own containers, own ports), so it never
# touches the Compose stack and the databases of `pnpm docker:up`.
#
# Usage:  scripts/ci-local.sh [options]      (or: pnpm ci:local [options])
#   --fast            format, lint, typecheck and unit tests only (no install, e2e, build, manifests, images)
#   --only <job>      run one job: verify, manifests or images
#   --skip-e2e        skip test:e2e (the slow one; needs Docker)
#   --skip-manifests  skip job 2
#   --skip-images     skip job 3
#   --no-install      skip `pnpm install --frozen-lockfile`
#   --jobs N          turbo concurrency and Jest workers (default 2)
#   --keep-going      run every step even after a failure
#   --keep            leave the throwaway PostgreSQL and Mosquitto containers running
#   --fresh           ignore Turborepo's cache (`--force`): lint, typecheck, test and build really run, as
#                     on a GitHub runner, which starts with no cache. Use it for the last run before a merge.
#   --clean           afterwards also delete what the run leaves behind: the images the images job built
#                     (ingest, simulator; PostgreSQL and Mosquitto are kept, `pnpm docker:up` uses them)
#                     and Turborepo's local cache (.turbo/cache)
#   -h, --help
#
# The manifests job needs `kustomize` and `kubeconform` on the PATH (brew install kustomize kubeconform).
# Without them it is reported as SKIP, not as a pass, and the summary says so.
#
# Caches: Turborepo's (.turbo/, git-ignored) makes a repeat run fast and, being keyed on file contents,
# is safe; Docker's build cache and the pnpm store are shared with `pnpm docker:demo` and are never
# pruned here (run `docker builder prune` yourself if the disk fills up). The throwaway containers and
# the temporary log folder are always removed. The images the images job builds are KEPT by default (the
# next build is faster, `pnpm docker:demo` uses the same ones); --clean removes them.
#
# Environment: CI_LOCAL_PG_PORT (e2e PostgreSQL, default 55433), CI_LOCAL_MQTT_PORT (e2e Mosquitto,
# default 51883). The e2e suite also listens on 3199 for its fake command center (fixed in the suite).

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2

RUN_VERIFY=1 RUN_MANIFESTS=1 RUN_IMAGES=1 RUN_E2E=1 RUN_BUILD=1 DO_INSTALL=1
JOBS=2 KEEP_GOING=0 KEEP=0 FORCE="" CLEAN=0

usage() { sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --fast) RUN_E2E=0; RUN_BUILD=0; RUN_MANIFESTS=0; RUN_IMAGES=0; DO_INSTALL=0 ;;
    --only)
      shift
      RUN_VERIFY=0 RUN_MANIFESTS=0 RUN_IMAGES=0
      case "${1:-}" in
        verify) RUN_VERIFY=1 ;;
        manifests) RUN_MANIFESTS=1 ;;
        images) RUN_IMAGES=1 ;;
        *) echo "--only takes 'verify', 'manifests' or 'images'" >&2; exit 2 ;;
      esac ;;
    --skip-e2e) RUN_E2E=0 ;;
    --skip-manifests) RUN_MANIFESTS=0 ;;
    --skip-images) RUN_IMAGES=0 ;;
    --no-install) DO_INSTALL=0 ;;
    --jobs) shift; JOBS="${1:-2}" ;;
    --keep-going) KEEP_GOING=1 ;;
    --keep) KEEP=1 ;;
    --fresh) FORCE="--force" ;;
    --clean) CLEAN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$JOBS" in ''|*[!0-9]*|0) echo "--jobs takes a positive integer" >&2; exit 2 ;; esac

# --- bookkeeping -------------------------------------------------------------------------------

STEP_NAMES=() STEP_RESULTS=() STEP_SECS=()
STARTED_AT=$(date +%s)
PG_NAME=itp-ci-local-pg
MQTT_NAME=itp-ci-local-mqtt
PG_PORT="${CI_LOCAL_PG_PORT:-55433}"
MQTT_PORT="${CI_LOCAL_MQTT_PORT:-51883}"
FAKE_OCC_PORT=3199
CONTAINERS_STARTED=0
IMAGES_BUILT=0
FAILED=0
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/itp-ci-local.XXXXXX")"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL:\033[0m %s\n' "$*" >&2; return 1; }
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

summary() {
  local i total=$(( $(date +%s) - STARTED_AT )) failed=0 skipped=0
  say "Summary (sha $(git rev-parse --short HEAD), working tree $([ -n "$(git status --porcelain)" ] && echo dirty || echo clean))"
  for i in "${!STEP_NAMES[@]}"; do
    printf '  %-6s %-40s %4ss\n' "${STEP_RESULTS[$i]}" "${STEP_NAMES[$i]}" "${STEP_SECS[$i]}"
    [ "${STEP_RESULTS[$i]}" = FAIL ] && failed=1
    [ "${STEP_RESULTS[$i]}" = SKIP ] && skipped=1
  done
  FAILED=$failed
  printf '  total %ss\n' "$total"
  if [ "$failed" -eq 1 ]; then echo "CI (local): FAILED"
  elif [ "$skipped" -eq 1 ]; then echo "CI (local): no step failed, but some were SKIPPED (not checked)"
  else echo "CI (local): all steps passed"; fi
  return "$failed"
}

# Removes only the images this Compose project builds (services with `build` and no `image`), by
# name. Not `docker compose down --rmi`: that also removes the containers of `pnpm docker:up`.
remove_built_images() {
  local image
  while IFS= read -r image; do
    docker image rm "$image" >/dev/null 2>&1 && echo "Removed image $image" ||
      echo "Kept image $image (in use, or already gone)"
  done < <(docker compose --profile demo config --format json 2>/dev/null |
    jq -r '.name as $p | .services | to_entries[] | select(.value.build != null) | .value.image // "\($p)-\(.key)"')
}

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    [ "$CONTAINERS_STARTED" -eq 1 ] && echo "Kept $PG_NAME (port $PG_PORT) and $MQTT_NAME (port $MQTT_PORT); docker rm -f them when done."
  elif [ "$CONTAINERS_STARTED" -eq 1 ]; then
    docker rm -f "$PG_NAME" "$MQTT_NAME" >/dev/null 2>&1
  fi
  if [ "$CLEAN" -eq 1 ]; then
    rm -rf .turbo/cache
    [ "$IMAGES_BUILT" -eq 1 ] && remove_built_images
  fi
  # The logs are only worth keeping after a failure.
  [ "$FAILED" -eq 0 ] && rm -rf "$LOG_DIR"
  return 0
}
trap cleanup EXIT

# run_step <name> <command...>: times it, records it, stops at the first failure unless --keep-going.
# A command that returns 77 is recorded as SKIP (a tool is missing): reported, never counted as a pass.
run_step() {
  local name="$1"; shift
  say "$name"
  local t0 rc; t0=$(date +%s)
  "$@"; rc=$?
  case "$rc" in 0) STEP_RESULTS+=(ok) ;; 77) STEP_RESULTS+=(SKIP) ;; *) STEP_RESULTS+=(FAIL) ;; esac
  STEP_NAMES+=("$name"); STEP_SECS+=("$(( $(date +%s) - t0 ))")
  if [ "${STEP_RESULTS[$(( ${#STEP_RESULTS[@]} - 1 ))]}" = FAIL ] && [ "$KEEP_GOING" -eq 0 ]; then
    summary; exit 1
  fi
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing tool: $1 ($2)" >&2; exit 2; }; }

# --- job 1: verify -------------------------------------------------------------------------------

# CI runs the same Mosquitto image with the repository's config (a `docker run` step) and PostgreSQL as a
# service container; here both are throwaway containers on their own ports, so the Compose stack of `pnpm docker:up` is left alone.
start_e2e_services() {
  need docker "e2e needs a throwaway PostgreSQL and Mosquitto; use --skip-e2e to go without"
  local p
  for p in "$PG_PORT" "$MQTT_PORT" "$FAKE_OCC_PORT"; do
    if port_in_use "$p"; then fail "port $p is taken (set CI_LOCAL_PG_PORT / CI_LOCAL_MQTT_PORT; 3199 is fixed by the suite)"; return 1; fi
  done
  docker rm -f "$PG_NAME" "$MQTT_NAME" >/dev/null 2>&1
  CONTAINERS_STARTED=1
  docker run -d --name "$PG_NAME" -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=telemetry_test -p "127.0.0.1:$PG_PORT:5432" postgres:17-alpine >/dev/null || return 1
  # Same image and config as docker-compose.yml and as the broker step of ci.yml.
  docker run -d --name "$MQTT_NAME" -v "$PWD/deploy/mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" \
    -p "127.0.0.1:$MQTT_PORT:1883" eclipse-mosquitto:2.0.18 >/dev/null || return 1
  local i
  for i in $(seq 1 60); do
    if docker exec "$PG_NAME" pg_isready -U postgres -d telemetry_test >/dev/null 2>&1 &&
       docker exec "$MQTT_NAME" mosquitto_pub -h 127.0.0.1 -t ci/ready -m 1 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  fail "PostgreSQL and Mosquitto did not become ready in 60 s"
}

e2e() {
  start_e2e_services || return 1
  # Real environment variables, as in ci.yml. The suite drops the schema of this database and refuses
  # any name that does not end in _test (V1-T03); DATABASE_URL is never read.
  TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:$PG_PORT/telemetry_test" \
  MQTT_URL="mqtt://127.0.0.1:$MQTT_PORT" \
    pnpm exec turbo run test:e2e --concurrency=1
}

# `pnpm test` runs three runners (Jest, Vitest, node --test) and only Jest takes --maxWorkers, so the
# ingest package is run on its own with the cap and the other two as they are.
unit() {
  pnpm exec turbo run test --concurrency="$JOBS" $FORCE --filter=@itp/ingest -- --maxWorkers="$JOBS" &&
    pnpm exec turbo run test --concurrency="$JOBS" $FORCE --filter='!@itp/ingest'
}

# The ingest unit tests again with coverage; fails below the floor in apps/ingest/jest.config.ts.
# ci.yml also uploads the report as an artifact; here it stays in apps/ingest/coverage.
coverage() {
  pnpm exec turbo run test:coverage --concurrency="$JOBS" $FORCE --filter=@itp/ingest -- --maxWorkers="$JOBS"
}

verify_job() {
  need pnpm "corepack enable"
  local want have
  want="$(tr -d 'v \n' < .nvmrc | cut -d. -f1)"; have="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$want" = "$have" ] || echo "warning: .nvmrc says Node $want, this shell has Node $have"

  [ "$DO_INSTALL" -eq 1 ] && run_step "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile
  run_step "format:check"  pnpm format:check
  run_step "lint"          pnpm exec turbo run lint --concurrency="$JOBS" $FORCE
  run_step "typecheck"     pnpm exec turbo run typecheck --concurrency="$JOBS" $FORCE
  run_step "test (unit)"   unit
  run_step "test:coverage (ingest floor)" coverage
  [ "$RUN_E2E" -eq 1 ]   && run_step "test:e2e (throwaway PostgreSQL + Mosquitto)" e2e
  [ "$RUN_BUILD" -eq 1 ] && run_step "build" pnpm exec turbo run build --concurrency="$JOBS" $FORCE
  # docs/openapi.json must match the controllers; the check reads the build made just above.
  [ "$RUN_BUILD" -eq 1 ] && run_step "OpenAPI document is current" pnpm --filter @itp/ingest openapi:check
}

# --- job 2: manifests ---------------------------------------------------------------------------

manifests() {
  local tool
  for tool in kustomize kubeconform; do
    command -v "$tool" >/dev/null 2>&1 || {
      echo "SKIP: $tool is not installed (brew install kustomize kubeconform); the manifests were NOT validated." >&2
      return 77
    }
  done
  # Same commands and versions as ci.yml (kustomize 5.7.1, kubeconform 0.7.0): compare `--version`.
  kustomize build --load-restrictor LoadRestrictionsNone deploy/k8s/overlays/local > "$LOG_DIR/rendered.yaml" || return 1
  kubeconform -strict -summary -kubernetes-version 1.33.0 "$LOG_DIR/rendered.yaml"
}

manifests_job() {
  run_step "manifests: kustomize + kubeconform" manifests
}

# --- job 3: images ---------------------------------------------------------------------------------

images_job() {
  need docker "the images job builds the Compose images"
  # Build only, nothing is started: it shares Docker's build cache with `pnpm docker:demo`.
  IMAGES_BUILT=1
  run_step "images: docker compose --profile demo build" docker compose --profile demo build
}

# --- go --------------------------------------------------------------------------------------------

[ "$RUN_VERIFY" -eq 1 ] && verify_job
[ "$RUN_MANIFESTS" -eq 1 ] && manifests_job
[ "$RUN_IMAGES" -eq 1 ] && images_job
summary

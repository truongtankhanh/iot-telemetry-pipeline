---
paths:
  - '.github/**'
  - 'deploy/**'
  - 'scripts/**'
  - 'docker-compose.yml'
  - '**/Dockerfile'
---

# Ops, CI and deploy rules

## Workflows

- `permissions: contents: read`, a `timeout-minutes` on every job, no secrets. Third-party actions are pinned to
  the commit of a release with the version in a comment; Dependabot (monthly) moves the pins. Do not use a
  floating tag. Downloaded tools are checked with `sha256sum`.
- `ci.yml` and `scripts/ci-local.sh` change in the same pull request (the script's header says so). The
  other three workflows (`occ-contract.yml`, `platform-aws-contract.yml`, `security.yml`) are not switched by
  `CI_ENABLED` and not run by `ci:local`.
- Dependabot ignores major versions of npm packages, `node` and `postgres`; a major is adopted by hand in one
  change that touches every place naming it (`.nvmrc`, `engines`, both Dockerfiles, `ci.yml`, `ci-local.sh`).

## Images and manifests

- Both Dockerfiles install from the manifests first with a BuildKit cache mount, and pin `node:24-alpine` by
  digest. Keep that order: copying `apps/` before `pnpm install` reinstalls on every source change.
- The Kubernetes base runs non-root with a read-only root filesystem; `maxSurge: 1`, `maxUnavailable: 0`,
  `terminationGracePeriodSeconds: 30` match `stop_grace_period` in Compose. Change the drain time in all
  places (and platform-aws's `stopTimeout`, which nothing here checks).
- `eclipse-mosquitto` has five copies of its tag (see `CLAUDE.md`); `postgres:17-alpine` appears in Compose,
  `ci.yml`, `ci-local.sh` and the Kubernetes overlay.
- Compose ports come from `.env.example` (`POSTGRES_HOST_PORT`, `MQTT_HOST_PORT`, `PROMETHEUS_HOST_PORT`,
  `GRAFANA_HOST_PORT`). The `observe` profile is a demo and published on localhost only.

## Observability files

- `deploy/observability/prometheus/alerts.yml` has one rule per row of the suggested-alerts table in
  `docs/operations.md`; every metric they use must exist in `apps/ingest/src/metrics/metrics.ts`.

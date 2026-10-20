---
paths:
  - '**/*.spec.ts'
  - '**/*.e2e-spec.ts'
  - '**/*.test.ts'
  - '**/*.test.tsx'
  - '**/*.test.mjs'
  - 'apps/ingest/test/**'
---

# Testing rules

## Runners and names

| Where                         | Runner                 | Files                                       |
| ----------------------------- | ---------------------- | ------------------------------------------- |
| `apps/ingest/src`             | Jest 30 with `ts-jest` | `*.spec.ts` next to the code                |
| `apps/ingest/test`            | Jest, in band          | `*.e2e-spec.ts`, helpers in `test/support/` |
| `packages/telemetry-contract` | Vitest                 | `*.test.ts`                                 |
| `apps/simulator`              | `node --test`          | `*.test.ts`                                 |
| `apps/simulator-ui`           | Vitest (jsdom)         | `*.test.ts(x)` next to the code, `scripts/` |
| `scripts/`                    | `node --test`          | `*.test.mjs`                                |

Three runners are kept on purpose (Studio uses the contract's Vitest, with its own jsdom config and setup file). Jest needs `NODE_OPTIONS=--experimental-vm-modules`; use the package scripts.

## Rules

- A fix comes with the test that fails without it, in the same change.
- Controller tests that go through the real validation pipe use `configureApp` (`*.http.spec.ts`); a hand-built
  DTO skips the pipe and proves less.
- The e2e suite boots the real application against a real PostgreSQL and Mosquitto, with a fake command center
  and identity provider, and starts two replicas for the multi-replica cases. It drops the `public` schema, so it
  reads `TEST_DATABASE_URL` only and `test/e2e-env.js` refuses a name that does not end in `_test`. Never point
  it at another database.
- Contract tests read snapshots in `apps/ingest/test/contract/` (refresh with `scripts/sync-occ-openapi.sh` and
  `scripts/sync-platform-aws.sh`); do not edit a snapshot by hand.
- Coverage has a floor in `apps/ingest/jest.config.ts`. Raise it when coverage rises; never lower it to pass.
- Run one heavy command at a time; `pnpm ci:local` throttles itself (`--jobs`).

# V1-T03: The e2e suite drops the `public` schema of whatever `DATABASE_URL` is

- **Status:** Done
- **Version:** V1
- **Type:** Safety (developer tooling)
- **Found in:** documentation review, 2026-10-16

## Problem

`pnpm test:e2e` starts with `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` on the database named
by `DATABASE_URL`. The e2e environment defaults to `…/telemetry_test`, but uses `DATABASE_URL` if it is
already set in the shell. A developer who has exported the URL of their working database (the same
variable the service reads) would lose its data on the next e2e run, with no prompt.

Turborepo passes `DATABASE_URL` and `MQTT_URL` through to the e2e task (`turbo.json`), which makes
this easier to trigger, not harder.

## Evidence

- [`pipeline.e2e-spec.ts`](../../../apps/ingest/test/pipeline.e2e-spec.ts) `beforeAll`: the `DROP SCHEMA`.
- [`e2e-env.js`](../../../apps/ingest/test/e2e-env.js): `process.env.DATABASE_URL ??= …/telemetry_test`.
- [`turbo.json`](../../../turbo.json): `test:e2e` env passthrough.

## Impact on the demo

Medium for a developer, none for a reader. Mitigated for now by a warning in the
[README](../../../README.md#quality) and the [development guide](../../development.md#tests).

## If this system were ever promoted

The same pattern in a team with shared development databases would eventually destroy someone's data.

## Options

1. **Use a separate variable** (e.g. `TEST_DATABASE_URL`) for e2e, never falling back to
   `DATABASE_URL`.
2. **Refuse unless the database name ends in `_test`**, and fail with a clear message otherwise.
3. **Create a throwaway database** per run (`CREATE DATABASE telemetry_e2e_<pid>`) and drop it after,
   leaving every other database alone. Strongest; needs the role to have `CREATEDB`.

Options 1 and 2 together are the smallest safe change.

## Resolution

Options 1 and 2 together, plus a second check where the `DROP` is:

- [`e2e-env.js`](../../../apps/ingest/test/e2e-env.js) reads `TEST_DATABASE_URL` (default
  `…/localhost:5432/telemetry_test`) and never `DATABASE_URL`, then sets `DATABASE_URL` for the
  application from it. It throws before any connection if the database name does not end in `_test`
  (an unparsable URL counts as not ending in it).
- [`pipeline.e2e-spec.ts`](../../../apps/ingest/test/pipeline.e2e-spec.ts) `beforeAll` asks the server
  for `current_database()` and refuses to run the `DROP SCHEMA` unless that ends in `_test` — the name
  the server reports, not the one in the URL.
- `turbo.json` passes `TEST_DATABASE_URL` through to `test:e2e` instead of `DATABASE_URL`, so a
  `DATABASE_URL` exported in the shell no longer reaches the suite. `scripts/e2e-ingest.sh` and the CI
  workflow set the new variable.
- The warnings in the README, the development guide and the ingest README became a short description
  of the guard.

Checked on 2026-10-16 by loading `e2e-env.js` with `DATABASE_URL` pointing at `prod`: a
`TEST_DATABASE_URL` ending in `telemetry`, or not a URL, aborts with the message; one ending in
`telemetry_test`, or none, proceeds to the `telemetry_test` default. Then `pnpm e2e:ingest` ran green (1 suite, 8 tests passed).

## Acceptance criteria

- With `DATABASE_URL` pointing at a database not named for tests, `pnpm test:e2e` aborts before
  executing any destructive statement and says why.
- CI keeps working with its `telemetry_test` database.
- The warnings in the README and the development guide are replaced by a short description of the
  guard.

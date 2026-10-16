# ADR-0010: Check the values platform-aws hard-codes against this service

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

platform-aws deploys this service and hard-codes values that must equal ours: the topic filter, the
share group and client id prefix (the IoT policy grants exactly those), the port and probe path, the
Keycloak client id, the environment variables it sets, and the metric names its CloudWatch selectors
and alarms read. Nothing compares them, so a rename on either side breaks the deployed system
(a denied connection, a message nobody receives, an alarm that never fires) while both test suites pass
([V1-T07](../tasks/v1/V1-T07-aws-constants-not-tied-to-pipeline.md)).

## Options

1. **Publish the contract from here** as a package platform-aws imports. One definition, but the
   package must be installable from the other repository.
2. **A parity test** that compares the two sides.
3. **A generated manifest** (`contract.json`) emitted here and read by platform-aws's tests.

## Decision

Option 2, run in this repository and reading platform-aws, in the same way as
[ADR-0009](0009-contract-check-against-command-center-openapi.md) reads the command center's OpenAPI:
neither repository has to change to adopt it.

- [`platform-aws.contract.spec.ts`](../../apps/ingest/src/platform-aws.contract.spec.ts) reads a
  **snapshot** of platform-aws's `lib/stacks/telemetry.ts` (`apps/ingest/test/contract`, refreshed by
  `scripts/sync-platform-aws.sh`) and checks, against the real code: the topic filter; the share group
  and the exact `$share/<group>/<filter>` string this service subscribes with; the client id prefix
  against the client id the service builds; the port and the health route; the Keycloak client id; that
  every environment variable platform-aws sets is one this service reads; and that every metric it
  selects exists, with the labels it splits by.
- The snapshot is TypeScript read with regular expressions. That is crude on purpose: it needs nothing
  from platform-aws, and when the file is restructured the lookups fail with the name of what they
  could not find, which is the signal to revisit the test.
- A scheduled workflow, [`platform-aws-contract.yml`](../../.github/workflows/platform-aws-contract.yml),
  runs the test daily against platform-aws's current `main` (`PLATFORM_AWS_TELEMETRY_PATH`), so a change
  there fails something here. `PLATFORM_AWS_TELEMETRY_PATH=../platform-aws/lib/stacks/telemetry.ts`
  checks the sibling checkout by hand.

## Consequences

- Changing the share group, topic filter, client id prefix, a probe path or a metric name used by an
  alarm on either side, without the other, fails a test here: at once for our side (the test reads
  the snapshot), after a refresh or within a day for platform-aws's.
- platform-aws's own tests are unchanged and do not know about this one. If its owner wants the check
  in their CI as well, option 3 is the natural step: this repository would emit the manifest.
- It checks names and values, not that AWS accepts them: IoT policy evaluation and the CloudWatch agent
  configuration still need a deployed environment.
- Metrics added here that platform-aws does not select (for example the write-retry metrics) are not
  an error; only the ones it selects are checked.

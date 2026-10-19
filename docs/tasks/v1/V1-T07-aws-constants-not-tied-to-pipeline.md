# V1-T07: platform-aws constants are not tied to this repository

- **Status:** Done (the scheduled workflow has not run on GitHub yet)
- **Version:** V1
- **Type:** Test gap
- **Found in:** local-workflow review, 2026-10-16
- **Spans:** iot-telemetry-pipeline, platform-aws

## Problem

platform-aws hard-codes values that must equal the ones in this repository, and nothing checks that
they do. A change on either side breaks the deployed system at runtime (a denied connection, a message
nobody receives, a missing metric) while both repositories' tests pass.

| Value                | Here                                                        | platform-aws                                            |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Topic filter         | `TELEMETRY_FILTER` in the contract                          | `TELEMETRY_TOPIC_FILTER` in `lib/stacks/telemetry.ts`   |
| Share group          | `MQTT_SHARE_GROUP` default `ingest`                         | `SHARE_GROUP`                                           |
| Client id prefix     | `MQTT_CLIENT_ID_PREFIX` default `ingest`                    | `INGEST_CLIENT_ID_PREFIX`, IoT policy `client/ingest-*` |
| Port and probe paths | 3100, `/api/health`, `/api/ready`                           | `INGEST_PORT`, ECS health check                         |
| Metric names         | [`metrics.ts`](../../../apps/ingest/src/metrics/metrics.ts) | CloudWatch selectors and the `SequenceGaps` alarm       |
| Keycloak client id   | `OCC_CLIENT_ID` (`telemetry-pipeline`)                      | `PIPELINE_CLIENT_ID`                                    |

The full list, with the other repositories involved, is in
[system-context.md](../../system-context.md#3-values-that-must-agree-across-repositories).

## Evidence

- platform-aws: `lib/stacks/telemetry.ts` (constants, IoT policy, metrics sidecar declarations, alarms) and `test/platform.test.ts`.
- This repo: [`telemetry-contract`](../../../packages/telemetry-contract/src/index.ts), [`mqtt-options.ts`](../../../apps/ingest/src/telemetry/mqtt-options.ts), [`metrics.ts`](../../../apps/ingest/src/metrics/metrics.ts).

## Impact on the demo

Low. platform-aws is synthesised and tested but not deployed from a live account, and it is not part
of the local demo.

## If this system were ever promoted

A rename of a metric or of the share group would silently disable an alarm or cut the ingest service
off from the broker, found only in the deployed environment.

## Options

1. **Publish the contract from here.** Export the shared constants (topic filter, group, prefix) from
   `@itp/telemetry-contract` and have platform-aws import them, so there is one definition. Needs the
   package to be installable from the other repository.
2. **A parity test in platform-aws** that fetches this repository's constants (a pinned ref or a small
   generated JSON file) and asserts equality with its own.
3. **A generated manifest.** This repository emits a `contract.json` (constants, metric names, probe
   paths) in CI; platform-aws's tests read it. Same effect as option 2 with a clear artefact.

## Resolution

Option 2, run from this repository, recorded in [ADR-0010](../../adr/0010-parity-test-against-platform-aws.md):

- [`platform-aws.contract.spec.ts`](../../../apps/ingest/src/platform-aws.contract.spec.ts) reads a
  snapshot of platform-aws's `lib/stacks/telemetry.ts` and compares it with the real code: topic
  filter, share group (and the exact `$share/…` filter the service subscribes with), client id prefix
  (against the client id built by `mqttConnectOptions`), port and health route, Keycloak client id,
  that every environment variable platform-aws sets is one `Env` declares, and that every metric it
  selects exists with the labels it splits by.
- The snapshot is `apps/ingest/test/contract/platform-aws-telemetry.ts.txt`, refreshed by
  [`scripts/sync-platform-aws.sh`](../../../scripts/sync-platform-aws.sh);
  `PLATFORM_AWS_TELEMETRY_PATH` checks any other copy.
- [`platform-aws-contract.yml`](../../../.github/workflows/platform-aws-contract.yml) runs it daily
  against platform-aws's current `main`. It has not run on GitHub yet, and needs that repository to be
  readable without a token.

Not compared: the image name and tag. No change was made in platform-aws.

Verified on 2026-10-16, each time against a copy of platform-aws's file with one line changed:

| Change in platform-aws                                                  | Result                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `SHARE_GROUP` from `ingest` to `ingest2`                                | The share-group test fails: expected `ingest`, received `ingest2`            |
| `telemetry_sequence_gaps_total` renamed `telemetry_gaps_total`          | The metric test fails and lists `telemetry_gaps_total` as no longer exported |
| `MQTT_SHARE_GROUP` mistyped `MQTT_SHARE_GROUPS` in the task environment | The environment test fails and lists `MQTT_SHARE_GROUPS` as unknown          |

In each run the other five tests passed. The run with the unmodified snapshot was not reported
separately; that it passes six of six follows from each test passing in at least one run where its
own input was untouched. This is the acceptance criterion about changing a share group or a metric
name on one side only.

## Acceptance criteria

- Changing the share group, topic filter, client id prefix or a metric name used by an alarm in one
  repository, without the other, makes a test fail.
- [system-context.md](../../system-context.md) and the
  [development guide](../../development.md#known-gaps-in-this-workflow) are updated.

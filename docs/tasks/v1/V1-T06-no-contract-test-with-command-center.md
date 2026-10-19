# V1-T06: No automated contract test between the pipeline and the command center

- **Status:** Done (the scheduled workflow has not run on GitHub yet)
- **Version:** V1
- **Type:** Test gap
- **Found in:** local-workflow review, 2026-10-16
- **Spans:** iot-telemetry-pipeline, ops-command-center

## Problem

The pipeline's end-to-end suite talks to a **fake** command center and a fake identity provider, both
written in this repository. If the real command center changes an endpoint, a field, the role model
or the idempotency behaviour, the fake keeps answering the old way: both repositories stay green and
the integration is broken. Today the only check is the manual procedure in the
[development guide](../../development.md#manual-integration-check-pipeline-and-command-center).

## Evidence

- [`pipeline.e2e-spec.ts`](../../../apps/ingest/test/pipeline.e2e-spec.ts): `fakeCommandCenter()` and the token endpoint on `127.0.0.1:3199`.
- [`ops-command-center.sink.ts`](../../../apps/ingest/src/delivery/ops-command-center.sink.ts): calls `GET /zones`, `POST /incidents` (with `Idempotency-Key`), `POST /incidents/:id/resolve`.
- ops-command-center publishes its API as `docs/api/openapi.json` and `docs/api/incidents.md`.

## Impact on the demo

Low. The integration is small (three calls) and the manual check takes a few minutes. The risk is a
silent break after the command center changes, found only when someone runs the demo.

## If this system were ever promoted

Independent releases of the two services would be able to break alert delivery without any pipeline
test failing.

## Options

1. **Validate the fake against the OpenAPI document.** Copy or fetch the command center's
   `openapi.json` and assert that the requests the sink makes (path, method, body, headers) and the
   responses the fake returns conform to it. Cheapest; catches shape drift, not behaviour.
2. **Consumer-driven contract (e.g. Pact).** The pipeline publishes the interactions it needs; the
   command center verifies them in its CI. Strongest; adds tooling to both repositories.
3. **An optional integration job** that starts the command center's Compose stack and runs the manual
   scenario. Closest to reality; slow and heavy, so not for every pull request.

## Resolution

Option 1, on the real sink, recorded in [ADR-0009](../../adr/0009-contract-check-against-command-center-openapi.md):

- [`ops-command-center.contract.spec.ts`](../../../apps/ingest/src/delivery/ops-command-center.contract.spec.ts)
  drives `OpsCommandCenterSink` and validates what it sends and what it reads against the command
  center's `openapi.json` (bearer scheme, the three paths and methods, the request bodies for every
  rule in `rules.json`, the `Idempotency-Key` header, the documented `409` on resolve, and the response
  fields the sink depends on).
- The document is a snapshot in `apps/ingest/test/contract/`, refreshed by
  [`scripts/sync-occ-openapi.sh`](../../../scripts/sync-occ-openapi.sh); `OCC_OPENAPI_PATH` points the
  test at any other copy.
- [`occ-contract.yml`](../../../.github/workflows/occ-contract.yml) runs the test daily against the
  command center's current `main`, so a breaking change there fails here without anyone touching this
  repository. It has not run yet (it needs GitHub, and the command center's repository must be readable
  without a token).
- `ajv` was added as a development dependency of `@itp/ingest`.

It does not check behaviour (idempotency window, the client's role, Keycloak); the manual integration
check stays for that.

Verified on 2026-10-16 (7 tests): with the snapshot, all pass. With a copy of the document in which
`/api/incidents/{id}/resolve` is renamed, the authentication check and the resolve test fail with
"POST /api/incidents/<id>/resolve is not documented by the command center". With a copy in which
`ReportIncidentDto` requires a new field (`assetId`), the four incident-creation tests fail with
"must have required property 'assetId'". This is the acceptance criterion about renaming or changing
required fields.

## Acceptance criteria

- Renaming or removing `POST /incidents/:id/resolve` (or changing the required incident fields) in the
  command center makes a test in at least one repository fail.
- The chosen approach is recorded in an ADR, and the "Known gaps" list in the
  [development guide](../../development.md#known-gaps-in-this-workflow) is updated.

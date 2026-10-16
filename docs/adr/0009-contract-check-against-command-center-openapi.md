# ADR-0009: Check the command center integration against its OpenAPI document

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

The pipeline reaches ops-command-center with three calls: `GET /zones`, `POST /incidents` (with an
`Idempotency-Key`) and `POST /incidents/:id/resolve`, all with a bearer token. The end-to-end suite
answers them with a fake written in this repository, so a change in the real API leaves both
repositories green and breaks alert delivery
([V1-T06](../tasks/v1/V1-T06-no-contract-test-with-command-center.md)). The command center already
publishes `docs/api/openapi.json`, generated from its controllers and DTOs.

## Options

1. **Validate against the published OpenAPI document.** Cheap; catches drift in shape (paths,
   methods, required fields, enums, headers, status codes), not in behaviour.
2. **Consumer-driven contracts (Pact).** The strongest, but both repositories adopt a tool, and the
   command center's CI would have to run our verification.
3. **An optional job that starts the command center's Compose stack** and runs the manual scenario.
   Closest to reality, slow and heavy.

## Decision

Option 1, in this repository, on the real sink rather than on the fake.

- [`ops-command-center.contract.spec.ts`](../../apps/ingest/src/delivery/ops-command-center.contract.spec.ts)
  drives `OpsCommandCenterSink` and checks, against the document: each call's method and path is
  documented; the bearer scheme is declared; the request body of `POST /incidents` (one per rule in
  `rules.json`, so every `incidentType` and severity we can send) and of the resolve call validates
  against the schema; the `Idempotency-Key` header exists and accepts our key; the id parameter
  accepts the incident id; `409` is documented on resolve (the sink treats it as success); and the
  response schemas still require the fields the sink reads (`id`, `code`).
- The document is a **snapshot** in `apps/ingest/test/contract/occ-openapi.json`, so the check runs in
  every pull request without network or another checkout. `scripts/sync-occ-openapi.sh` refreshes it.
- A scheduled workflow, [`occ-contract.yml`](../../.github/workflows/occ-contract.yml), runs the same
  test daily against the command center's current `main` (`OCC_OPENAPI_PATH`), which is what makes a
  breaking change there fail something here. It is separate from the pull-request workflow because it
  depends on another repository.
- Validation uses `ajv` (a development dependency only), which already sat in the lockfile through
  ESLint; JSON Schema validation is not worth hand-writing.

## Consequences

- Renaming or removing `POST /incidents/{id}/resolve`, making a new incident field required, or
  dropping an `incidentType` we send fails the contract test, here as soon as the snapshot is
  refreshed and within a day through the scheduled run.
- It does not prove behaviour: that the idempotency key is honoured for 24 h, that the
  `telemetry-pipeline` client has the role to resolve a given incident type, or that Keycloak issues
  the token. Those stay with the manual integration check in the development guide.
- The snapshot can lag the command center between refreshes. The scheduled run is the guard against
  that; the command center's own repository does not run this test.
- Making the e2e fake itself conform to the document was not done: it answers with only the fields
  the sink reads, and the contract test checks those against the document instead.
- Revisit with option 2 if a third consumer appears or the command center wants to see our needs in
  its own CI.

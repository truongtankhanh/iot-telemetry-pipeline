# V2-T04: Service-to-service authentication for the API and the stream

- **Status:** On hold (starts after ops-command-center V2 is done)
- **Version:** V2
- **Type:** Security
- **Spans:** iot-telemetry-pipeline, ops-command-center, platform-aws
- **Absorbs:** [V1-T04](../v1/V1-T04-unauthenticated-api-metrics-docs.md)

## Problem

Today the direction "pipeline → command center" is authenticated (client credentials against the
command center's Keycloak, ADR-0006). The reverse direction, which V2 introduces, is not: the
pipeline's HTTP API has no authentication at all, and the catalogue sync (V2-T01) and the stream
(V2-T03) would put the command center's API in the role of a client of the pipeline.

## Scope

1. **Verify bearer tokens in the pipeline.** Validate OIDC access tokens from the same Keycloak realm
   (issuer, audience, signature via the realm's JWKS), with caching and a clear failure mode when the
   identity provider is unreachable.
2. **A role for reading telemetry.** A dedicated realm role (for example `telemetry:read`) held by
   the command center API's service account, and a separate one for operators if the read API is ever
   shown to people. The stream requires the role; so do the read endpoints.
3. **The command center API as a client.** It obtains a token with client credentials (as the
   pipeline does today in the other direction), renews it, and reconnects its stream with the current
   token.
4. **What stays open.** `/api/health` and `/api/ready` for orchestrator probes. `/metrics` stays on
   the network layer (private), as in the command center, which serves it on a separate port.
5. **OpenAPI UI switch.** Done in V1-T04 ([ADR-0008](../../adr/0008-api-docs-switch-and-network-only-access.md)):
   `API_DOCS_ENABLED`, off by default, off in the Kubernetes base.
6. **Platform.** Keycloak client and secret for the command center's use of the pipeline,
   security-group rules between the two services, and the secret in Secrets Manager (platform-aws).
7. **Broker hardening** from V1-T04 (password file or client certificates, TLS, per-device ACL) stays
   a separate item unless V2 needs it; record it here as a decision.

## Evidence

- Pipeline: [`configure-app.ts`](../../../apps/ingest/src/configure-app.ts), controllers under `apps/ingest/src`, [ADR-0006](../../adr/0006-client-credentials-to-the-command-center.md) (the other direction).
- Command center: `docs/adr/0010-oidc-authentication.md`, `0011-role-based-authorization-and-timeline-actor.md`, `0005-api-docs-exposure-per-environment.md`.
- platform-aws: Keycloak realm preparation (`scripts/prepare-realm.sh`) and the telemetry stack.

## Acceptance criteria

- Requests to `/api/devices`, `/api/alerts`, the readings endpoint, the snapshot and the stream
  without a valid token return `401`; with a token lacking the role, `403`. The e2e suite covers both.
- The OpenAPI UI can be disabled by configuration and is disabled in the Kubernetes base.
- The command center API can obtain and renew a token and keep a stream open across a token expiry.
- [operations.md](../../operations.md#security-posture) and [system-context.md](../../system-context.md)
  describe the new state; V1-T04 is marked Done with a pointer here.

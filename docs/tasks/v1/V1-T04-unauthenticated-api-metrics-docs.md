# V1-T04: API, `/metrics` and OpenAPI UI have no authentication

- **Status:** Done for V1 (options 1 and 2); options 3 and 4 moved to [V2-T04](../v2/V2-T04-service-to-service-auth.md)
- **Version:** V1
- **Type:** Security
- **Found in:** documentation review, 2026-10-16

## Problem

Every HTTP endpoint is open: `/api/devices`, `/api/devices/:id/readings`, `/api/alerts`, `/api/health`,
`/api/ready`, `/metrics`, and the OpenAPI UI at `/api/docs`. The UI cannot be switched off by
configuration. The sibling project ops-command-center decides this per environment
([its ADR-0005](https://github.com/truongtankhanh/ops-command-center/blob/main/docs/adr/0005-api-docs-exposure-per-environment.md)) and
authenticates every API call with OIDC; this service does neither.

Related development-only defaults that are intentional for a demo but worth listing in one place:
Mosquitto allows anonymous clients on plain port 1883
([`mosquitto.conf`](../../../deploy/mosquitto/mosquitto.conf)), and Compose and the local Kubernetes
overlay contain throwaway passwords.

## Evidence

- [`configure-app.ts`](../../../apps/ingest/src/configure-app.ts): `SwaggerModule.setup('api/docs', …)` unconditionally.
- [`health.controller.ts`](../../../apps/ingest/src/health/health.controller.ts): `/metrics` without a guard.
- [`docker-compose.yml`](../../../docker-compose.yml): port 3100 published on the host.
- [`ingest.yaml`](../../../deploy/k8s/base/ingest.yaml): `Service` is cluster-internal only (not exposed by default).

## Impact on the demo

None for the intended use (a local stack). The data is synthetic.

## If this system were ever promoted

Anyone who can reach the port could read device data and alert history, and could learn the service's
shape from the OpenAPI UI. Metrics would also reveal traffic volume.

## Options

1. **Network only.** Keep the service on a private network and document it (current state on
   Kubernetes and AWS, where it is not publicly routed).
2. **Switch for the docs UI.** An environment variable (default off outside local), mirroring the
   command center's decision.
3. **Authenticate the read API** with the same Keycloak realm as the command center (bearer token,
   a read role), leaving `/api/health`, `/api/ready` and `/metrics` to the network layer.
4. **Broker hardening** as a separate step: password file or client certificates, TLS, per-device ACL.

## Resolution

Options 1 and 2, recorded in [ADR-0008](../../adr/0008-api-docs-switch-and-network-only-access.md):

- `API_DOCS_ENABLED` (default `false`) decides whether [`configureApp`](../../../apps/ingest/src/configure-app.ts)
  mounts the OpenAPI UI at `/api/docs` and its JSON at `/api/docs-json`. Off means both return 404.
- On in `apps/ingest/.env.example` and the Compose demo; explicitly `false` in the Kubernetes base
  (`telemetry-ingest-env`), so every overlay inherits it.
- The read API, probes and `/metrics` stay unauthenticated and rely on the network (the Kubernetes
  `Service` is cluster-internal). [operations.md](../../operations.md#security-posture) says so.
- Covered by `configure-app.spec.ts`: enabled serves the UI and the document, disabled returns 404 for both. Passed on 2026-10-16 (2 tests).

Not done, on purpose: option 3 (bearer tokens, a read role, 401 in the e2e suite) and option 4 (broker
hardening). Both need the design in V2-T04, which is on hold until ops-command-center V2 is done, so the
acceptance criterion about `401` does not apply to V1. V2-T04 no longer has to introduce the docs switch.

## Acceptance criteria

- Whatever is chosen is recorded in an ADR.
- The OpenAPI UI can be disabled by configuration, and is disabled in the Kubernetes base.
- If option 3 is taken, an unauthenticated request to `/api/alerts` returns `401`, and the e2e suite
  covers it.
- [operations.md](../../operations.md#security-posture) reflects the new state.

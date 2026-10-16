# ADR-0008: OpenAPI UI behind a switch; the API stays network-only for V1

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Every HTTP endpoint of the ingest service is open: the read API, the probes, `/metrics` and the
OpenAPI UI at `/api/docs`, which could not be turned off
([V1-T04](../tasks/v1/V1-T04-unauthenticated-api-metrics-docs.md)). The sibling project
ops-command-center authenticates every call with OIDC and decides per environment whether to serve
its docs. This repository is a V1 demonstration system (see the README), and the next version already
plans service-to-service authentication, on hold until ops-command-center V2 is done
([V2-T04](../tasks/v2/V2-T04-service-to-service-auth.md)).

## Options

1. **Network only.** Keep the service on a private network and document it.
2. **A switch for the docs UI.** An environment variable.
3. **Authenticate the read API** with the command center's Keycloak realm (bearer token, a read role).
4. **Harden the broker** (password file or client certificates, TLS, per-device ACL).

## Decision

Options 1 and 2 now; options 3 and 4 stay in V2-T04, where they can be designed together with the
command center acting as a client of this API.

- `API_DOCS_ENABLED` (boolean, **default `false`**) controls the OpenAPI UI at `/api/docs` and its
  JSON at `/api/docs-json`. When it is off neither route exists (404) and the document is not even
  built.
- Local development (`apps/ingest/.env.example`) and the Compose demo turn it on, because the README
  sends readers there. The Kubernetes base sets it to `false` explicitly, so the local overlay and any
  other overlay inherit the safe value; an overlay has to opt in.
- The read API, the probes and `/metrics` remain unauthenticated and are protected by the network
  alone: the Kubernetes `Service` is cluster-internal, and Compose publishes port 3100 on the host
  for the demo only.

## Consequences

- Secure by default: a deployment that forgets the variable exposes no UI. The cost is that an
  existing `apps/ingest/.env` created before this change has no docs UI until it sets
  `API_DOCS_ENABLED=true`.
- The API is still readable by anyone who can reach the port. That is acceptable for synthetic data
  on a laptop and not otherwise; the operations guide's security table says so.
- V2-T04 keeps option 3 (bearer tokens, roles, 401/403 in the e2e suite) and option 4. It no longer
  has to introduce the docs switch.

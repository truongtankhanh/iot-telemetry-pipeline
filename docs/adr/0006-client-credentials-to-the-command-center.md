# ADR-0006: Authenticate to the command center with client credentials

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

ops-command-center now requires an OIDC access token from its Keycloak on every request, and
reads the caller's permissions from the token's realm roles (its ADR-0010 and ADR-0011). The
outbox (ADR-0005) called it anonymously, so alerts stopped becoming incidents. The pipeline is a
service, not a person: it has no browser and no one to sign in.

The platform decision is in
[architecture-decisions ADR-0006](https://github.com/truongtankhanh/architecture-decisions/blob/main/decisions/0006-service-to-service-authentication.md);
this record is the pipeline's side of it.

## Options

1. **A user account with a password** (resource-owner password grant) — works, but the grant is
   deprecated, the realm disables it, and a person's account would be doing a machine's job.
2. **A long-lived API key issued by the command center** — needs a second credential type in the
   command center.
3. **OAuth 2.0 client credentials** — the pipeline is a confidential client `telemetry-pipeline`
   whose service account holds a realm role; its token is verified like any operator's.

## Decision

Option 3.

- `ClientCredentials` fetches a token with `OCC_CLIENT_ID` / `OCC_CLIENT_SECRET` from
  `OCC_TOKEN_URL`, caches it until 30 s before it expires, and shares one request between
  concurrent callers. The three settings are set together or not at all; without them the sink
  sends no token, as before.
- Every request carries the token. A `401` renews it and repeats the request once; a second `401`
  fails the delivery, which the outbox retries with backoff — wrong credentials show up as failed
  deliveries, not as a tight loop.
- Incident creation sends `Idempotency-Key: telemetry-alert-<alert id>`. The command center keeps
  keys for 24 hours, longer than the outbox's whole retry schedule, so a retry after a lost
  response returns the incident created the first time (closing the duplicate risk ADR-0005
  accepted).
- The service account holds `technician`: it may report any incident, and acknowledge or resolve
  facilities and environment incidents. Every rule therefore raises a facilities type — the CO₂
  rule moved from `crowding` (security) to `hvac_fault`, which is what high CO₂ in an occupied room
  usually is: ventilation not keeping up.

## Consequences

- Incidents raised by the pipeline are attributed in the command center's timeline to
  `service-account-telemetry-pipeline`.
- A client secret now exists. It is injected like the database password and exchanged for
  short-lived tokens; it never travels to the command center's API.
- Deliveries depend on Keycloak too: while it is down they fail and are retried, like any outage
  of the command center.
- A rule that should raise a security incident needs a role beyond `technician` for resolving it;
  that is a deliberate widening, made in the realm, not here.

## Verification

Run end to end against the real ops-command-center V2 API (built from its `main`, PostgreSQL,
seeded campus) with a Keycloak-shaped token endpoint: the overheat scenario opened an alert, the
pipeline created `INC-000011` (`equipment_fault`, reported by `service-account-telemetry-pipeline`),
and resolved it when the temperature recovered; repeating a creation with the same key created
one incident. The e2e suite checks the token flow and the key against a fake command center.

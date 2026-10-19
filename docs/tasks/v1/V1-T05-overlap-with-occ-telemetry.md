# V1-T05: Two telemetry paths: this pipeline and the command center's own

- **Status:** Decided, partly recorded; cross-repository items open. Direction: [ADR-0007](../../adr/0007-pipeline-as-the-single-telemetry-source.md) (the pipeline becomes the single source; [V2 tasks](../v2/README.md)). Closes when the command center's V3 is done.
- **Version:** V1
- **Type:** Decision
- **Found in:** documentation review, 2026-10-16
- **Spans:** iot-telemetry-pipeline, ops-command-center, platform-aws

## Problem

The platform has two independent ways for sensor data to become an incident:

| Aspect        | iot-telemetry-pipeline                              | ops-command-center (its ADR-0018, ADR-0019)                 |
| ------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Unit          | Device, grouped by zone                             | Asset with named telemetry points                           |
| Topic         | `campus/<zone>/<device>/telemetry`                  | `occ/<site>/asset/<code>/telemetry`                         |
| Rules         | `rules.json`, per device kind, consecutive readings | Catalogue data in PostgreSQL, sustained for `for_s` seconds |
| Raises        | Facilities incident, reporter = service account     | Incident of type `telemetry`, reporter "System"             |
| Shown in      | Only as an incident                                 | Digital twin and `/telemetry` overview                      |
| Broker on AWS | AWS IoT Core, with client certificates              | Cannot reach IoT Core yet (password auth, no ALPN)          |

Neither feeds the other. A sensor that matters to both would have to publish twice, under two
topic schemes, and could raise two incidents for one event.

## Evidence

- This repo: [`telemetry-contract`](../../../packages/telemetry-contract/src/index.ts), [`rules.json`](../../../apps/ingest/config/rules.json), [system-context.md](../../system-context.md#7-open-points-across-the-three-repositories).
- ops-command-center: `docs/adr/0018-assets-and-telemetry-as-domain-data.md`, `docs/adr/0019-telemetry-transport.md`, `docs/api/telemetry.md`.
- platform-aws: `docs/adr/0003-aws-iot-core-as-the-broker.md` (consequences), `telemetrySource` in `lib/config.ts` (`mock` in staging, `off` in production).
- Related ticket: [ITP-15](../../roadmap.md) (mark pipeline-raised incidents with their own source).

## Impact on the demo

Low. They are shown as separate demos; the pipeline's incident screenshot in the README is real. The
risk is explaining the platform: a reader may reasonably ask which telemetry path is "the" one.

## If this system were ever promoted

Two rules engines and two topic schemes to operate, with the possibility of duplicate or conflicting
incidents for the same physical event.

## Options

1. **Keep them separate on purpose.** The pipeline handles environmental zone sensors; the command
   center handles equipment assets for the twin. State the boundary (which devices belong where) and
   ensure no device appears in both.
2. **The pipeline feeds the command center's asset view.** Map `device`/`metric` onto asset points
   (via a bridge or a second sink); the command center keeps rendering, the pipeline keeps storing
   and evaluating, and one side drops its rules.
3. **Converge on one topic scheme and one engine.** Largest change; one of the two services gives up
   its telemetry responsibility.

## Progress (2026-10-16)

Option 3 was chosen, in the shape of [ADR-0007](../../adr/0007-pipeline-as-the-single-telemetry-source.md):
the pipeline becomes the single telemetry source and the command center drops MQTT in its V3. Until
then both paths coexist, so the boundary for now is: **a device publishes to exactly one of the two
topic schemes**, and nothing in the pipeline's `devices.json` is also a command-center asset.

| Acceptance criterion                                                             | State                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decision as an ADR in `architecture-decisions`, with a pointer ADR in each repo  | **Open.** Only this repository has the ADR (0007, full text). The platform-wide ADR and the pointers in ops-command-center and platform-aws do not exist yet |
| [system-context.md](../../system-context.md) and the sibling READMEs describe it | This repository: done (section 7, item 1). Sibling READMEs: **open**                                                                                         |
| Tickets raised where code must change; ITP-15 re-evaluated                       | Pipeline: done ([V2-T01 to V2-T06](../v2/README.md), on hold). ops-command-center V3 and platform-aws tickets: **open**. ITP-15: see below                   |

ITP-15 (a source marker on pipeline-raised incidents) stays valid while both paths coexist, because
until V3 an operator cannot otherwise tell a pipeline incident from a manual one. Proposed, not decided:
after V3 every telemetry incident comes from the pipeline, and [V2-T02](../v2/V2-T02-rules-parity-and-evidence.md)
already makes them carry the command center's `telemetry` shape and evidence note, so ITP-15 would be
folded into V2-T02 rather than built separately. To be confirmed with the command center's owner.

This task closes when the command center's V3 is done (ADR-0007).

## Acceptance criteria

- A decision is recorded as an ADR in the platform-wide `architecture-decisions` repository, with a
  short pointer ADR in each affected repository.
- [system-context.md](../../system-context.md) and the sibling READMEs describe the chosen boundary.
- If option 2 or 3 is chosen, tickets are raised in the repositories that must change, and ITP-15 is
  re-evaluated against it.

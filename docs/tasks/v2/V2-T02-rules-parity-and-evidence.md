# V2-T02: Rules parity with the command center, and the incident evidence note

- **Status:** On hold (starts after ops-command-center V2 is done)
- **Version:** V2
- **Type:** Feature
- **Spans:** iot-telemetry-pipeline, ops-command-center
- **Depends on:** [V2-T01](V2-T01-asset-catalogue-sync.md)

## Problem

When the pipeline replaces the command center's telemetry, the pipeline's rules engine must produce
what the command center's does today. The two differ:

| Aspect               | Pipeline today                                       | Command center today (ADR-0018)                                                              |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Scope of a rule      | Device kind and metric                               | Asset class and point, with an optional per-asset override of the same name                  |
| Sustain              | `for`: consecutive readings                          | `for_s`: seconds; a gap of more than three intervals restarts the dwell                      |
| Fields               | `raise`, `clear`, `direction`                        | `limit`, `clear`, `comparator` (`above`/`below`), `enabled`                                  |
| Value kinds          | Numbers                                              | Numbers and booleans (e.g. a leak sensor)                                                    |
| One open incident    | One open alert per device and rule                   | At most one open incident per asset and rule                                                 |
| Recovery             | **Auto-resolves** the incident when the alert clears | **Does not auto-resolve**: recovery is shown, a human resolves (rejected option in ADR-0018) |
| Where the rule lives | `rules.json` in the pipeline                         | Database rows, changed by migration                                                          |

Two consequences need explicit decisions, not a silent port.

## Scope

1. **Rule model.** Class rules with per-asset overrides, `limit`/`clear`/`comparator`/`for_s`/
   `severity`/`incident_type`/`enabled`, boolean points. Evaluate by time (seconds), using the point's
   `expected_interval_s` for the gap rule.
2. **Rule ownership.** Recommended: rules travel with the catalogue, owned by the command center and
   synchronised (V2-T01), so there is one place to edit. `rules.json` remains only for rules on
   devices that have no asset. Confirm before building.
3. **Recovery policy.** Decide whether pipeline-raised incidents still auto-resolve. The pipeline's
   demo (README screenshot) resolves on recovery; the command center deliberately does not. Pick one
   policy for the platform and record it.
4. **Evidence note.** The console explains why an incident exists by parsing the note of the
   incident's first `reported` timeline entry, in exactly this form (its `telemetryEvidence.ts`,
   written by its `formatRuleEvidence`):

   ```
   motorTempC 92 > 85 for 60 s
   ```

   Incidents created by the pipeline must carry the same note, or both repositories agree on a
   contract field instead. Add a test on each side that pins the same sample strings.

5. **Link the incident to its asset and rule.** The incident the pipeline creates today has type,
   severity, title, description and zone only. The command center links telemetry incidents to an
   asset (`assetId`) and a rule. This needs an extension of `POST /api/incidents` (or an equivalent
   service endpoint) in the command center, and replaces the need for ITP-15's "own source" marker.
6. **Idempotency and one-open-incident.** Keep the pipeline's `Idempotency-Key` per alert, and make
   sure the command center's one-open-incident-per-(asset, rule) guarantee still holds when its own
   evaluation is switched off.

## Evidence

- Pipeline: [`rules-engine.ts`](../../../apps/ingest/src/rules/rules-engine.ts), [`rules.service.ts`](../../../apps/ingest/src/rules/rules.service.ts), [`ops-command-center.sink.ts`](../../../apps/ingest/src/delivery/ops-command-center.sink.ts).
- Command center: `docs/adr/0018-assets-and-telemetry-as-domain-data.md` (Evaluation, rejected auto-resolve), `apps/api/src/telemetry/rules/rule-evidence.ts`, `apps/console/src/lib/telemetryEvidence.ts`, `apps/api/src/telemetry/rule-evaluator.service.ts`.

## Acceptance criteria

- The command center's demo breaches (cooling tower motor temperature, leak sensor) raise the same
  incident through the pipeline as through the command center's own evaluator today: same type,
  severity, title shape, asset link and evidence note.
- The console's evidence block renders for a pipeline-raised incident without a console change.
- A boolean point can have a rule.
- The recovery policy is written down and tested.
- No second incident is created when both evaluators are accidentally active at once (guarded by the
  one-open-incident rule), during the V2 to V3 overlap.

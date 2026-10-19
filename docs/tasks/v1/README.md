# Tasks (V1)

Open work found while documenting the repository. This repository is at **V1** and is a
**demonstration system, not intended for production use** (see the [README](../../../README.md#scope-v1-demo-only)).
Each task is therefore written against that scope: "Impact on the demo" is what a reader of the demo
could be misled by or hit today; "If this system were ever promoted" is why the item would matter
beyond the demo.

These are separate from the [roadmap](../../roadmap.md), which holds the numbered `ITP-*` tickets. A task
here can be promoted to a roadmap ticket when someone commits to doing it.

| ID                                                       | Title                                                                  | Type     | Version |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | -------- | ------- |
| [V1-T01](V1-T01-sequence-gap-metric-multi-replica.md)    | Sequence-gap metric over-counts with more than one consumer            | Bug      | V1      |
| [V1-T02](V1-T02-failed-flush-drops-batch.md)             | A failed flush drops its batch and the loss is not visible as gaps     | Risk     | V1      |
| [V1-T03](V1-T03-e2e-wipes-database.md)                   | The e2e suite drops the `public` schema of whatever `DATABASE_URL` is  | Safety   | V1      |
| [V1-T04](V1-T04-unauthenticated-api-metrics-docs.md)     | API, `/metrics` and OpenAPI UI have no authentication                  | Security | V1      |
| [V1-T05](V1-T05-overlap-with-occ-telemetry.md)           | Two telemetry paths: this pipeline and the command center's own        | Decision | V1      |
| [V1-T06](V1-T06-no-contract-test-with-command-center.md) | No automated contract test between the pipeline and the command center | Test gap | V1      |
| [V1-T07](V1-T07-aws-constants-not-tied-to-pipeline.md)   | platform-aws constants are not tied to this repository                 | Test gap | V1      |

## Task file format

`Status` (Open / In progress / Done), `Version` (the release the task was raised against), `Type`,
`Found in`, then Problem, Evidence (files to check), Impact on the demo, If this system were ever
promoted, Options, and Acceptance criteria. Keep evidence as file references so a task can be
re-validated before work starts.

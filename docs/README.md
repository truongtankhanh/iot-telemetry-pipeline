# Documentation

> **V1, demo only — not for production.** See the [README](../README.md#scope-v1-demo-only).

| I want to…                                                   | Read                                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Understand what the pipeline is and why it is built this way | [architecture.md](architecture.md), then the [ADRs](adr/)              |
| See how it fits with ops-command-center and platform-aws     | [system-context.md](system-context.md)                                 |
| Make a device or gateway publish data                        | [telemetry-contract.md](telemetry-contract.md)                         |
| Configure the service, devices and alert rules               | [configuration.md](configuration.md)                                   |
| Query readings and alerts over HTTP                          | [api.md](api.md)                                                       |
| Run, monitor and troubleshoot it                             | [operations.md](operations.md)                                         |
| Run and test across the three repositories                   | [development.md](development.md#working-across-the-three-repositories) |
| Change the code                                              | [development.md](development.md)                                       |
| Know how fast it is, and what has not been measured          | [benchmarks.md](benchmarks.md)                                         |
| See known risks and open decisions                           | [tasks/](tasks/README.md)                                              |
| See what is planned                                          | [roadmap.md](roadmap.md)                                               |

## Decision records

| ADR                                                          | Decision                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [0001](adr/0001-mqtt-shared-subscriptions.md)                | Scale ingest horizontally with MQTT 5 shared subscriptions                                  |
| [0002](adr/0002-ack-on-receipt-with-bounded-loss.md)         | Acknowledge on receipt; bound and measure the loss window                                   |
| [0003](adr/0003-plain-postgres-partitions-and-rollups.md)    | Plain PostgreSQL: daily partitions + write-time rollups                                     |
| [0004](adr/0004-rules-with-hysteresis.md)                    | Threshold rules with consecutive-breach count and a separate clear threshold                |
| [0005](adr/0005-alert-outbox.md)                             | Deliver alerts through a transactional outbox                                               |
| [0006](adr/0006-client-credentials-to-the-command-center.md) | Authenticate to the command center with client credentials                                  |
| [0007](adr/0007-pipeline-as-the-single-telemetry-source.md)  | The pipeline becomes the platform's single telemetry source; the command center consumes it |
| [0008](adr/0008-api-docs-switch-and-network-only-access.md)  | OpenAPI UI behind a switch (off by default); the API stays network-only for V1              |

## Conventions for these documents

- Written in English; code, identifiers and routes are quoted exactly as they appear in the code.
- A claim about behaviour points at the file that implements it, so it can be checked.
- Numbers that were measured say how ([benchmarks.md](benchmarks.md)); things that were designed
  but not observed are labelled as such.
- When behaviour changes, update the page that describes it in the same change. Cross-repository
  values are listed in [system-context.md](system-context.md#3-values-that-must-agree-across-repositories).

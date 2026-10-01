# ADR-0004: Threshold rules with consecutive breaches and hysteresis

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

A naive rule ("alert when temperature > 27 °C") produces an alert storm when the value hovers
around 27: raise, clear, raise, clear. A single noisy sample also raises a false alarm.

## Decision

Each rule has:

- a **raise threshold** and a **separate clear threshold** (hysteresis band), e.g. raise above
  27 °C, clear only below 25.5 °C;
- a **consecutive-breach count**: the alert opens only after `for` readings in a row breach;
- a severity and a human title, used as the incident in the command center.

Rules are declared in `config/rules.json` per device kind and metric, and validated at startup.

State per (device, rule) — the current breach streak and whether an alert is open — is kept in
memory for speed. Because shared subscriptions may move a device between replicas (ADR-0001),
the open/closed part of the state is **rebuilt from the `alert` table** the first time a replica
sees a device. A partial unique index (`one open alert per device and rule`) makes a race between
two replicas impossible to turn into two alerts.

## Consequences

- No flapping; one alert per real episode.
- The breach streak can reset when a device moves between replicas; at worst an alert opens a
  few readings later. Acceptable for a campus; documented.
- Rules are code-reviewed config, not a UI. A rules editor is a later milestone.

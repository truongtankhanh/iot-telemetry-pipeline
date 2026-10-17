# ADR-0004: Threshold rules with consecutive breaches and hysteresis

- **Status:** Accepted; amended 2026-10-17 for a failing database (see the amendment below)
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

## Amendment (2026-10-17): a failing database

The decision above says how an alert opens and clears, not what happens when the database fails between "the readings are
stored" and "the alert row is written". The first version advanced a rule's in-memory state **before** it wrote the alert. If the
write failed, the state said "open" (or "closed") while the `alert` table said the opposite, nothing retried it (the readings
had already committed, so a redelivered message is a duplicate and never reaches the rules again), and the alert never opened
or cleared until the process restarted. The only trace was one log line. The readings side of a failing database is in
[ADR-0002](0002-ack-on-receipt-with-bounded-loss.md); this is the rules side.

**Decision:**

- **State follows the write.** A rule's state for a device moves on only after the alert row and its outbox row
  ([ADR-0005](0005-alert-outbox.md)) are written, or when the reading causes no transition. Memory therefore never gets ahead of
  the `alert` table.
- **The error decides, as in ADR-0002.** When PostgreSQL rejects the data itself (SQLSTATE class 22 or 23), that one evaluation is
  dropped, logged and counted in `alerts_evaluation_dropped_total`, and the state is left as it was, so the next reading that
  matches triggers the transition again. Any other failure says nothing about the data: the evaluation that failed and every
  later one are queued, oldest first, and retried before anything newer. Later evaluations wait too, so that a retry never counts
  one reading's breach twice or applies readings out of order.
- **When it retries.** On the next flush that stores readings, and once more at shutdown. There is no timer: if the database
  recovers and every device stays silent, a deferred transition waits for the next flush or for shutdown.
- **Bounded memory.** The queue holds at most 10 000 evaluations (a constant, not a setting). Past that the oldest are dropped and
  counted in `alerts_evaluation_dropped_total`. `alerts_evaluation_pending` is its current length.

**Consequences:**

- A database blip between the readings and the alert no longer loses the transition: the alert opens or clears once the database
  is back. `alerts_evaluation_pending` above zero for more than a few minutes means a transition is waiting on the database.
- The queue is memory, like the write buffer. A hard kill, or a database that is still down when the process shuts down, loses the
  pending evaluations. At shutdown they are logged at `error` with their count. The readings are stored in both cases, and the
  alert appears on the next matching reading, so the cost is a delayed alert, not a contradiction with the `alert` table.
- Two replicas retrying the same transition cannot create two alerts: the partial unique index on open alerts still decides.
- The multi-replica wording of the decision above (state rebuilt "the first time a replica sees a device", streaks per replica)
  is unchanged.

# ADR-0004: Threshold rules with consecutive breaches and hysteresis

- **Status:** Accepted; amended 2026-10-17 for a failing database and for state that drifts from the table (see the amendments below)
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

## Amendment (2026-10-17): state that drifts from the table

The decision above rebuilds the open/closed part of a rule's state from the `alert` table "the first time a replica sees a
device". That is true of the first sight and says nothing about the sights after it, and replicas keep changing alerts that
the others have cached. Reproduced with two replicas in the e2e suite: both cache a rule as closed, one opens the alert and
then leaves (a scale-down, a lost pod), the device returns to normal and only the other replica hears it. That replica
caches the rule as closed, so it never evaluates a clear: the alert stays open in the table until the process restarts.
The mirror image is a missed alert: a replica that cached an alert as open, which another replica then cleared, waits for a
clear that never comes and never opens the next one. A rolling deploy hides the problem (a new pod starts with an empty
cache); a scale-down or a long-lived survivor shows it.

**Options considered:** a query per reading (exact, and it puts a database round trip on the hottest path); a timer that
reconciles in the background (a new lifecycle hook and a timer that fires for replicas that hear nothing); reconciling at the
start of an evaluation, at most once per interval (chosen).

**Decision:**

- **Reconcile on use.** At the start of an evaluation, if more than `RECONCILE_INTERVAL_MS` (30 s, a constant in
  `RulesService`, not a setting) have passed since the last comparison, a replica reads the open alerts once and sets the
  cached state of every pair it holds to what the table says. The breach streak of a corrected pair restarts at zero, as
  after a cache miss. Pairs it does not hold are loaded as before, on first sight.
- **Bounded, not removed.** The cached state can be wrong for up to the interval. Nothing is done per reading.
- **Visible.** A correction is counted in `alerts_state_corrections_total{direction}` (`to_open`, `to_closed`) and logged once
  per comparison, never per pair. A comparison that fails is logged and skipped; the evaluation goes on with the state it
  has.

**Consequences:**

- A survivor clears (or opens) alerts that a departed replica left in the other state within about 30 s of its next
  evaluation. A replica that hears nothing does not compare, which costs nothing and changes nothing.
- One cheap query per replica per interval while readings flow; open alerts are few and the partial index on open alerts
  covers it.
- The unique index on open alerts still decides a race between replicas, and the breach streak is still per replica
  (Known limitation 4 in the operations guide). Both are unchanged.

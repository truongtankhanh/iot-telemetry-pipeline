# Phase 0 — Decisions (gate)

Part of the [implementation order](../implementation-order.md).

## SIM-00: Accept the design and ADR-0011

- **Depends on:** SIM-01 (the [brief](../brief.md) and the [mockups](../mockups/))
- **Type:** Decision
- **Status:** Done 2026-10-19 (merged with the design in PR #46, 2026-10-20)

### Scope

1. Review the brief and its frames (fourteen when this ticket was written; twenty, 00 to 19, at revision 12); list what changes.
2. Accept [ADR-0011](../../../adr/0011-simulator-studio-control-plane.md), or amend it with a dated section.
3. Settle the brief's open questions that block SIM-04: a light theme in the first build or not, and Studio's port.
   The others (token sharing, custom scenario storage, benchmark process) are settled by the ticket that needs them.
4. Add ADR-0011 to the table in [docs/README.md](../../../README.md).

### Acceptance criteria

- ADR-0011 says **Accepted** and is listed in the docs index.
- The brief's open questions 1 and 5 have an answer written in the brief.

**Done 2026-10-19:** ADR-0011 and ADR-0012 accepted; no light theme; port `3200`.

- `pnpm docs:links` and `pnpm format:check` pass.

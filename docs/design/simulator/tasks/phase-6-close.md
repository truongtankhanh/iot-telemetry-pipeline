# Phase 6 — Close

Part of the [implementation order](../implementation-order.md).

## SIM-22: Docs and accessibility pass

- **Depends on:** SIM-15, SIM-21
- **Frames:** all

### Scope

1. The simulator README, `docs/development.md` (the manual integration check becomes "open Studio") and
   `docs/configuration.md` where a setting is shared.
2. The security-posture and known-limitations rows in `docs/operations.md`.
3. `docs/README.md` index, `docs/system-context.md` (the simulator's new role) and the roadmap entry.
4. A keyboard-only and reduced-motion pass over every frame; contrast of every token pair.
5. A short demo script for a presenter, kept next to the guided-demo script.

### Acceptance criteria

- A new developer can run the full demo from the README alone.
- `pnpm docs:links`, `pnpm format:check` and the whole CI pipeline pass; `ci.yml` and `scripts/ci-local.sh` agree.

### Suggested pipeline and commands

Run the shell commands from the repository root. Tests and commits are run by hand, one process at a time; these commands are meant to be pasted as they are.

**Start the branch**

```bash
git switch main && git pull --ff-only
git switch -c feat/sim-22-docs-and-accessibility
pnpm install --frozen-lockfile
pnpm --filter @itp/telemetry-contract build       # the simulator and ingest read the contract from dist/
```

**Pipeline** (Claude Code slash commands, one at a time; `analyze`, `plan` and `apply` each end at a STOP gate that you read before running the next; the artifacts go to `docs/plan/`)

```text
# documentation and a manual pass: no pipeline fits, apply by hand from the scope above
/steel-review-self main SIM-22
/steel-git-commit                      # after you stage; or use the draft message below
```

The `-verify` step needs you to run lint, build and tests and paste the output; it does not fix failures.

**Read first**

- `docs/development.md`
- `docs/operations.md` (Security posture, Known limitations)
- `docs/README.md`
- `docs/system-context.md`
- `docs/roadmap.md`

**Verify before the commit** (one at a time; throttled)

```bash
pnpm exec turbo run build lint typecheck --concurrency=2
pnpm format:check && pnpm docs:links
pnpm docs:openapi                                 # only if a route or DTO of ingest changed (it should not have)
git status --short docs/openapi.json              # must stay clean
```

**Check it by hand**

```bash
pnpm docker:demo                                  # a new developer runs the demo from the README alone; Ctrl+C stops it
pnpm docker:demo:down
# then the keyboard-only and reduced-motion pass over every frame
```

**Commit message** (draft; Sếp commits it)

```text
docs(simulator): document Studio and finish the accessibility pass
```

Before the pull request, `pnpm ci:local --fast` runs the CI jobs on this machine with throttling; it is heavy, so run it alone.

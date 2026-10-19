---
paths:
  - 'docs/**'
  - '**/README.md'
  - 'CLAUDE.md'
---

# Documentation rules

- English. Code, identifiers, routes and metric names are quoted exactly as they appear in the code.
- A claim about behaviour points at the file that implements it; a number that was measured says how, with the
  date, the commit and the machine, or says that they were not recorded. Things designed but not observed are
  labelled as such. A fact that comes from another repository or from AWS is attributed and, if this repository
  does not check it, says so.
- Link only to files that are tracked. `pnpm docs:links` fails on a missing file or anchor; working notes that are
  git-excluded on a developer's machine must never be linked from a tracked file.
- When behaviour changes, update the page that describes it in the same change; when a decision changes, amend
  the ADR (new section with a date) instead of rewriting it.
- `docs/openapi.json` is generated (`pnpm docs:openapi`), not edited.
- Markdown is formatted by Prettier (`pnpm format`); keep tables aligned by running it.

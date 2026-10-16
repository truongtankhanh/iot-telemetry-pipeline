#!/usr/bin/env bash
# Refreshes the snapshot of the command center's OpenAPI document that the contract test reads
# (apps/ingest/test/contract/occ-openapi.json, V1-T06). Run it when the command center's API changes,
# then run the ingest tests and commit the new snapshot together with whatever the sink needed.
#
#   scripts/sync-occ-openapi.sh                    from ../ops-command-center (sibling checkout)
#   scripts/sync-occ-openapi.sh <file-or-url>      from another copy, e.g. a branch under review
set -euo pipefail

cd "$(dirname "$0")/.."

source="${1:-../ops-command-center/docs/api/openapi.json}"
target="apps/ingest/test/contract/occ-openapi.json"

if [[ "$source" =~ ^https?:// ]]; then
  curl -fsSL "$source" -o "$target"
else
  cp "$source" "$target"
fi

# Prettier owns the formatting of every file in the repository.
pnpm exec prettier --write "$target" >/dev/null
echo "Updated $target from $source"

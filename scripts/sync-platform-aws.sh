#!/usr/bin/env bash
# Refreshes the snapshot of platform-aws's telemetry stack that the parity test reads
# (apps/ingest/test/contract/platform-aws-telemetry.ts.txt, V1-T07). Run it when platform-aws changes
# a value that concerns this service, then run the ingest tests and commit the snapshot together with
# whatever the test asked for.
#
#   scripts/sync-platform-aws.sh                   from ../platform-aws (sibling checkout)
#   scripts/sync-platform-aws.sh <file-or-url>     from another copy, e.g. a branch under review
set -euo pipefail

cd "$(dirname "$0")/.."

source="${1:-../platform-aws/lib/stacks/telemetry.ts}"
target="apps/ingest/test/contract/platform-aws-telemetry.ts.txt"

if [[ "$source" =~ ^https?:// ]]; then
  curl -fsSL "$source" -o "$target"
else
  cp "$source" "$target"
fi
echo "Updated $target from $source"

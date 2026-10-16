#!/usr/bin/env bash
#
# Turns the GitHub Actions CI of this repository off and on, with a repository variable.
#
#   scripts/ci-toggle.sh off       CI_ENABLED=false  -> every job of ci.yml is skipped
#   scripts/ci-toggle.sh on        CI_ENABLED=true   -> CI runs as usual
#   scripts/ci-toggle.sh status    prints the current value (unset counts as on)
#   (or: pnpm ci:off | ci:on | ci:status)
#
# ci.yml has `if: ${{ vars.CI_ENABLED != 'false' }}` on every job, so an unset variable means CI is on:
# the safe default. A skipped job counts as passed for a required status check, so branch protection
# will not block a merge while CI is off. That is the point, and the risk: run `pnpm ci:local` first.
# Only ci.yml is switched: the two scheduled contract workflows keep running.
#
# Needs one of: the GitHub CLI (`gh auth login`), or GH_TOKEN / GITHUB_TOKEN with permission to edit
# Actions variables (classic: `repo`; fine-grained: Variables read and write). Without either, set it by
# hand: Settings > Secrets and variables > Actions > Variables > CI_ENABLED.
# One-off alternative with no variable: put `[skip ci]` in a commit message (GitHub skips that push's runs).

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2

VAR=CI_ENABLED
CMD="${1:-status}"
SLUG="${GITHUB_REPOSITORY:-$(git remote get-url origin 2>/dev/null | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')}"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
API="https://api.github.com/repos/$SLUG/actions/variables"

[ -n "$SLUG" ] || { echo "Cannot work out owner/repo from 'origin'; set GITHUB_REPOSITORY=owner/repo" >&2; exit 2; }

curl_api() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

get_value() {
  if command -v gh >/dev/null 2>&1; then
    gh variable get "$VAR" --repo "$SLUG" 2>/dev/null || true
  elif [ -n "$TOKEN" ]; then
    curl_api "$API/$VAR" | jq -r '.value // empty'
  else
    return 3
  fi
}

set_value() {
  local value="$1"
  if command -v gh >/dev/null 2>&1; then
    gh variable set "$VAR" --body "$value" --repo "$SLUG"
  elif [ -n "$TOKEN" ]; then
    local status
    status=$(curl_api -o /dev/null -w '%{http_code}' -X PATCH "$API/$VAR" -d "{\"name\":\"$VAR\",\"value\":\"$value\"}")
    if [ "$status" = 404 ]; then
      status=$(curl_api -o /dev/null -w '%{http_code}' -X POST "$API" -d "{\"name\":\"$VAR\",\"value\":\"$value\"}")
    fi
    case "$status" in 200|201|204) ;; *) echo "GitHub answered HTTP $status" >&2; return 1 ;; esac
  else
    return 3
  fi
}

no_credentials() {
  cat >&2 <<EOF
Neither the GitHub CLI nor GH_TOKEN/GITHUB_TOKEN is available.
Do it by hand: https://github.com/$SLUG/settings/variables/actions  ->  $VAR = $1
(or install the CLI: brew install gh && gh auth login)
EOF
  exit 3
}

case "$CMD" in
  off) set_value false || { [ $? -eq 3 ] && no_credentials false; exit 1; }
       echo "CI is OFF for $SLUG ($VAR=false). Run 'pnpm ci:local' before merging; 'pnpm ci:on' to turn it back on." ;;
  on)  set_value true || { [ $? -eq 3 ] && no_credentials true; exit 1; }
       echo "CI is ON for $SLUG ($VAR=true)." ;;
  status)
       value="$(get_value)"; rc=$?
       [ $rc -eq 3 ] && no_credentials "(see the value)"
       if [ "$value" = false ]; then echo "CI is OFF for $SLUG ($VAR=false)."; else echo "CI is ON for $SLUG ($VAR=${value:-unset})."; fi ;;
  *) echo "Usage: $0 on|off|status" >&2; exit 2 ;;
esac

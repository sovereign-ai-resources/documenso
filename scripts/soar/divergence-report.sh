#!/usr/bin/env bash
# Lists the upstream files this fork's commits modify relative to the upstream
# release they are based on, so each sync shows how far the fork has drifted.
# Informational only: always exits 0.
#
# Files the fork adds (new files) are counted but not listed. The fork's own
# tooling (scripts/soar/, the soar-* workflows, SOAR-FORK.md, .gitleaks.toml)
# is excluded.
#
# Usage: divergence-report.sh [<base>]   (default: $SOAR_BASE or tag soar-base)
# Writes Markdown to $GITHUB_STEP_SUMMARY as well when that is set.
set -uo pipefail

base="${1:-${SOAR_BASE:-soar-base}}"
if ! git rev-parse -q --verify "$base^{commit}" >/dev/null; then
  echo "divergence: base '$base' not found; nothing to report"
  exit 0
fi

entries="$(git diff --name-status --no-renames "$base" HEAD -- . \
  ':(exclude)scripts/soar/**' \
  ':(exclude).github/workflows/soar-*' \
  ':(exclude)SOAR-FORK.md' \
  ':(exclude).gitleaks.toml' 2>/dev/null)"

modified="$(printf '%s\n' "$entries" | awk -F'\t' '$1 != "A" && NF >= 2 { print $1 "\t" $2 }')"
added_count="$(printf '%s\n' "$entries" | awk -F'\t' '$1 == "A"' | grep -c . || true)"
modified_count="$(printf '%s\n' "$modified" | grep -c . || true)"

report="$(
  echo "## Upstream files modified by this fork (vs $base)"
  echo
  if [ "$modified_count" -eq 0 ]; then
    echo "None."
  else
    echo "| Status | File |"
    echo "|---|---|"
    printf '%s\n' "$modified" | awk -F'\t' '{ printf "| %s | `%s` |\n", $1, $2 }'
  fi
  echo
  echo "Modified upstream files: $modified_count. New files added by the fork: $added_count."
)"

printf '%s\n' "$report"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '%s\n' "$report" >>"$GITHUB_STEP_SUMMARY" || true
fi
exit 0

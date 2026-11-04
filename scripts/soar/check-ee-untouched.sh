#!/usr/bin/env bash
# Fails if the branch changes anything under packages/ee relative to the
# upstream release it is based on. That directory is under the Documenso
# commercial license; this fork never modifies it.
#
# Usage: check-ee-untouched.sh [<base>]   (default: $SOAR_BASE or tag soar-base)
set -euo pipefail

base="${1:-${SOAR_BASE:-soar-base}}"
git rev-parse -q --verify "$base^{commit}" >/dev/null || {
  echo "ee-untouched: base '$base' not found (fetch tags, or set SOAR_BASE)" >&2
  exit 2
}

changed="$(git diff --name-status --no-renames "$base" HEAD -- packages/ee)"
if [ -n "$changed" ]; then
  echo "ee-untouched: this branch changes packages/ee relative to $base:"
  printf '%s\n' "$changed" | sed 's/^/  /'
  echo "Never modify packages/ee in this fork. Put the change in a new file outside it."
  exit 1
fi
echo "ee-untouched: packages/ee is identical to $base"

#!/usr/bin/env bash
# Picks the base the guardrails compare a branch against.
#
# Usage: sync-base.sh <branch name>
#   For a sync branch (sync/vX.Y.Z) the base is the upstream release it was
#   replayed onto, not soar-base, which still names the previous release until
#   the sync is promoted. The tag is fetched from upstream itself, overwriting
#   any local tag of that name, so a tag pushed to the fork cannot stand in for
#   the real release. Prints SOAR_BASE=<tag>, ready for $GITHUB_ENV.
#   For any other branch it prints nothing, so the default soar-base applies.
#
# Env: SOAR_UPSTREAM_URL (default: the upstream Documenso repository).
set -euo pipefail

ref="${1:?usage: sync-base.sh <branch name>}"
url="${SOAR_UPSTREAM_URL:-https://github.com/documenso/documenso.git}"

case "$ref" in
  sync/*) ;;
  *) exit 0 ;;
esac

tag="${ref#sync/}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "sync-base: '$ref' is not a sync branch name (sync/vX.Y.Z)" >&2
  exit 1
}
git fetch -q --no-tags "$url" "+refs/tags/$tag:refs/tags/$tag" >&2 || {
  echo "sync-base: upstream has no tag '$tag'" >&2
  exit 1
}
echo "SOAR_BASE=$tag"

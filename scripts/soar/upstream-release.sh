#!/usr/bin/env bash
# Decides what an upstream sync should do, by comparing upstream's release
# tags with the release the fork is based on.
#
# Usage: upstream-release.sh <upstream repo URL or path> [<tag>]
#   Only plain release tags (vX.Y.Z) count; prereleases such as v2.0.0-rc.1
#   are ignored. With <tag>, that release is the target instead of the newest.
#
# Prints key=value lines, ready to append to $GITHUB_OUTPUT:
#   current=<the upstream tag soar-base points at>
#   target=<the release to replay onto>
#   mode=none     target is the current release: nothing to do
#   mode=dry-run  <tag> was given and equals the current release: replay and
#                 check the result reproduces soar, but open nothing
#   mode=sync     target is newer: replay, test, and open a sync PR
# Exits 2 when soar-base is not an upstream release, or <tag> is not a release
# tag upstream has, or is older than the current release.
#
# Env: SOAR_BASE overrides the base ref (default: the tag soar-base).
set -euo pipefail

url="${1:?usage: upstream-release.sh <upstream repo URL or path> [<tag>]}"
want="${2:-}"
base="${SOAR_BASE:-soar-base}"
release_re='^v[0-9]+\.[0-9]+\.[0-9]+$'

base_sha="$(git rev-parse -q --verify "$base^{commit}")" || {
  echo "upstream-release: base '$base' not found (fetch tags, or set SOAR_BASE)" >&2
  exit 2
}

# tag<TAB>commit for every upstream release tag; for annotated tags the peeled
# (^{}) line names the commit and is listed after the tag line, so it wins.
releases="$(
  git ls-remote --tags "$url" 'v*' | awk '
    { name = $2; sub(/^refs\/tags\//, "", name); peeled = sub(/\^\{\}$/, "", name) }
    name ~ /^v[0-9]+\.[0-9]+\.[0-9]+$/ { if (peeled || !(name in sha)) sha[name] = $1 }
    END { for (n in sha) print n "\t" sha[n] }' | sort -V
)"
[ -n "$releases" ] || { echo "upstream-release: no release tags found at $url" >&2; exit 2; }

current="$(printf '%s\n' "$releases" | awk -F'\t' -v s="$base_sha" '$2 == s { print $1 }' | tail -n1)"
[ -n "$current" ] || {
  echo "upstream-release: $base ($base_sha) is not an upstream release tag" >&2
  exit 2
}

if [ -n "$want" ]; then
  [[ "$want" =~ $release_re ]] || { echo "upstream-release: '$want' is not a release tag (vX.Y.Z)" >&2; exit 2; }
  printf '%s\n' "$releases" | cut -f1 | grep -qxF "$want" ||
    { echo "upstream-release: upstream has no tag '$want'" >&2; exit 2; }
  target="$want"
else
  target="$(printf '%s\n' "$releases" | cut -f1 | tail -n1)"
fi

newest_of_two="$(printf '%s\n%s\n' "$current" "$target" | sort -V | tail -n1)"
if [ "$target" = "$current" ]; then
  mode="none"
  [ -n "$want" ] && mode="dry-run"
elif [ "$newest_of_two" = "$target" ]; then
  mode="sync"
else
  echo "upstream-release: $target is older than the current release $current" >&2
  exit 2
fi

printf 'current=%s\ntarget=%s\nmode=%s\n' "$current" "$target" "$mode"

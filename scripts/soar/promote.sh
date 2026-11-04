#!/usr/bin/env bash
# Promotes an approved sync branch: makes it the fork's deployable branch.
#
# Usage: promote.sh <new tag> <sync ref> [<replayed soar>]
#   <new tag>        the upstream release the sync branch was replayed onto
#   <sync ref>       the sync branch head, for example sync/v2.22.0 or a commit
#   <replayed soar>  the full SHA of the soar commit the sync branch was
#                    replayed from; when given, promotion is refused if soar
#                    has moved since, so a fork change merged after the replay
#                    is never dropped
#
# In one atomic push to $SOAR_REMOTE (default: origin) it:
#   - tags the current soar tip as soar-archive/<old release>, where <old
#     release> is the upstream tag soar-base points at
#   - force-moves soar to <sync ref>, leased on the soar tip it just read
#   - moves the tag soar-base to <new tag>, leased on its current value
# If anything moved in the meantime, or the archive tag already exists,
# nothing is pushed.
#
# Needs the upstream release tags locally (git fetch upstream --tags).
# Exit codes: 0 promoted, 1 usage or git error, 2 refused (checks failed).
set -euo pipefail

new_tag="${1:-}"
sync_ref="${2:-}"
replayed="${3:-}"
remote="${SOAR_REMOTE:-origin}"
release_re='^v[0-9]+\.[0-9]+\.[0-9]+$'
if [ -z "$new_tag" ] || [ -z "$sync_ref" ]; then
  echo "usage: promote.sh <new tag> <sync ref> [<replayed soar>]" >&2
  exit 1
fi
if [ -n "$replayed" ] && ! [[ "$replayed" =~ ^[0-9a-f]{40}$ ]]; then
  echo "promote: <replayed soar> must be a full commit SHA, not '$replayed'" >&2
  exit 1
fi

refuse() { echo "promote: $*" >&2; exit 2; }

git fetch -q --no-tags "$remote" \
  "+refs/heads/soar:refs/remotes/$remote/soar" \
  "+refs/tags/soar-base:refs/tags/soar-base"

old_soar="$(git rev-parse "refs/remotes/$remote/soar")"
old_base="$(git rev-parse "refs/tags/soar-base^{commit}")"
if [ -n "$replayed" ] && [ "$replayed" != "$old_soar" ]; then
  refuse "soar moved since the replay (replayed $replayed, soar is now $old_soar); run the sync again"
fi
old_tag="$(git tag --points-at "$old_base" -l 'v*' | grep -E "$release_re" | sort -V | tail -n1 || true)"
[ -n "$old_tag" ] || refuse "soar-base ($old_base) is not an upstream release tag; fetch upstream tags first"

[[ "$new_tag" =~ $release_re ]] || refuse "'$new_tag' is not a release tag (vX.Y.Z)"
new_base="$(git rev-parse -q --verify "refs/tags/$new_tag^{commit}")" || refuse "tag '$new_tag' not found; fetch it first"
if [ "$new_tag" = "$old_tag" ] || [ "$(printf '%s\n%s\n' "$old_tag" "$new_tag" | sort -V | tail -n1)" != "$new_tag" ]; then
  refuse "$new_tag is not newer than the current release $old_tag"
fi

sync_head="$(git rev-parse -q --verify "$sync_ref^{commit}")" || refuse "'$sync_ref' not found"
git merge-base --is-ancestor "$new_base" "$sync_head" || refuse "$sync_ref is not based on $new_tag"
[ "$sync_head" != "$old_soar" ] || refuse "$sync_ref is already soar"

echo "promote: soar $old_soar -> $sync_head"
echo "promote: soar-base $old_tag -> $new_tag"
echo "promote: archiving the old soar as soar-archive/$old_tag"
git push --atomic "$remote" \
  "--force-with-lease=refs/heads/soar:$old_soar" \
  "--force-with-lease=refs/tags/soar-base:$(git rev-parse refs/tags/soar-base)" \
  "$sync_head:refs/heads/soar" \
  "$new_base:refs/tags/soar-base" \
  "$old_soar:refs/tags/soar-archive/$old_tag"

git tag -f soar-base "$new_base" >/dev/null
git tag -f "soar-archive/$old_tag" "$old_soar" >/dev/null
echo "promote: done"

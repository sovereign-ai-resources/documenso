#!/usr/bin/env bash
# Replays the fork's stack of commits onto a new upstream release.
#
# Usage: replay.sh <new tag> [<source branch>]   (source default: soar)
#   Creates (or resets) the local branch sync/<new tag> at <source branch> and
#   runs: git rebase --onto <new tag> <base> sync/<new tag>
#   where <base> is $SOAR_BASE or the tag soar-base. Fetch the upstream tag
#   first, for example: git fetch upstream tag <new tag> --no-tags
#
# A conflict where every conflicted path is a package-lock.json is not treated
# as a conflict: the upstream side's lockfile is kept and regenerated with
# `npm install --package-lock-only --ignore-scripts`, and the replay goes on.
# Any other conflict aborts the rebase, restores the branch that was checked
# out, deletes sync/<new tag>, prints the fork commit and the conflicting
# files, and exits 2.
#
# Exit codes: 0 replayed (sync/<new tag> is checked out), 1 usage or state
# error, 2 conflict.
set -euo pipefail

tag="${1:-}"
source_branch="${2:-soar}"
base="${SOAR_BASE:-soar-base}"
[ -n "$tag" ] || { echo "usage: replay.sh <new tag> [<source branch>]" >&2; exit 1; }
branch="sync/$tag"

for ref in "$tag" "$base" "$source_branch"; do
  git rev-parse -q --verify "$ref^{commit}" >/dev/null ||
    { echo "replay: '$ref' not found (fetch it first)" >&2; exit 1; }
done
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "replay: the working tree has uncommitted changes; commit or stash them first" >&2
  exit 1
fi
if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
  echo "replay: a rebase is already in progress" >&2
  exit 1
fi

start="$(git symbolic-ref -q --short HEAD || git rev-parse HEAD)"
[ "$start" = "$branch" ] && start="$source_branch"

git checkout -q -B "$branch" "$source_branch"

# Non-interactive rebases must never open an editor.
export GIT_EDITOR=true
rc=0
git rebase -q --onto "$tag" "$base" "$branch" || rc=$?

while [ "$rc" -ne 0 ]; do
  mapfile -t conflicted < <(git diff --name-only --diff-filter=U)
  commit="$(git rev-parse -q --verify REBASE_HEAD || true)"

  lock_only=1
  [ "${#conflicted[@]}" -gt 0 ] || lock_only=0
  for f in "${conflicted[@]}"; do
    [ "$(basename "$f")" = package-lock.json ] || lock_only=0
  done

  if [ "$lock_only" -eq 0 ] || [ -z "$commit" ]; then
    echo "replay: conflict replaying fork commit $commit onto $tag"
    [ -n "$commit" ] && echo "replay: commit subject: $(git log -1 --format=%s "$commit")"
    echo "replay: conflicting files:"
    if [ "${#conflicted[@]}" -gt 0 ]; then
      printf '  %s\n' "${conflicted[@]}"
    else
      echo "  (none listed; the rebase stopped for another reason)"
    fi
    git rebase --abort
    git checkout -q "$start"
    git branch -q -D "$branch"
    exit 2
  fi

  # During a rebase "ours" is the side being built on: the upstream release
  # plus the fork commits already replayed. "theirs" is the fork commit being
  # replayed. Keep ours, then let npm fold in the fork's package.json changes.
  echo "replay: package-lock.json conflict in $(git log -1 --format='%h %s' "$commit"); taking upstream's and regenerating"
  for f in "${conflicted[@]}"; do
    git checkout --ours -- "$f"
    (cd "$(dirname "$f")" && npm install --package-lock-only --ignore-scripts)
    git add -- "$f"
  done

  rc=0
  if git diff --cached --quiet HEAD; then
    git rebase --skip || rc=$?
  else
    git rebase --continue || rc=$?
  fi
done

echo "replay: $branch at $(git rev-parse HEAD), $(git rev-list --count "$tag..HEAD") fork commit(s) on $tag"

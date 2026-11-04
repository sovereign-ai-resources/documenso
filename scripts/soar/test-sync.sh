#!/usr/bin/env bash
# Exercises the upstream sync scripts (upstream-release.sh, replay.sh,
# promote.sh, sync-base.sh) against throwaway git repositories.
#
# Builds a fake upstream with release tags, a fake fork remote whose `soar`
# branch is one release plus a stack of fork commits, and a working clone. It
# never touches the checkout it is run from, and stubs `npm` with a fake on
# PATH so no real npm or network is needed. Requires git.
set -euo pipefail

SOAR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

RESULTS="$WORK/results"
: >"$RESULTS"
ok() { echo pass >>"$RESULTS"; echo "  ok   - $1"; }
bad() { echo fail >>"$RESULTS"; echo "  FAIL - $1"; }
check() { # check <description> <command...>: passes when the command succeeds
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi
}

# expect <exit code> <description> <command...>; output is kept in $WORK/last.log
expect() {
  local want="$1" desc="$2"
  shift 2
  local rc=0
  "$@" >"$WORK/last.log" 2>&1 || rc=$?
  if [ "$rc" = "$want" ]; then
    ok "$desc"
  else
    bad "$desc (exit $rc, wanted $want)"
    sed 's/^/        /' "$WORK/last.log"
  fi
}
log_has() { grep -qF -- "$1" "$WORK/last.log"; }

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

commit_all() { git add -A && git commit -qm "$1"; }
tree_of() { git rev-parse "$1^{tree}"; }

# A fake npm: records its arguments and marks the lockfile as regenerated, so a
# test can tell which side's lockfile it started from.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/npm" <<'NPM'
#!/usr/bin/env bash
echo "$*" >>"$FAKE_NPM_LOG"
echo "regenerated-for: $(sha256sum package.json | cut -c1-12)" >>package-lock.json
NPM
chmod +x "$WORK/bin/npm"
export PATH="$WORK/bin:$PATH" FAKE_NPM_LOG="$WORK/npm.log"

UP="$WORK/upstream"
ORIGIN="$WORK/origin.git"

# Fake upstream: release v1.0.0.
git init -q -b main "$UP"
(
  cd "$UP"
  mkdir -p src packages/ee
  printf '{\n  "name": "app",\n  "dependencies": {\n    "left-pad": "1.0.0",\n    "lodash": "4.0.0",\n    "react": "18.0.0",\n    "zod": "3.0.0"\n  }\n}\n' >package.json
  printf 'lockfileVersion: 3\nleft-pad: 1.0.0\nzod: 3.0.0\n' >package-lock.json
  printf 'line one\nline two\nline three\n' >src/a.ts
  echo 'export const ee = 1;' >packages/ee/index.ts
  commit_all 'upstream 1.0.0'
  git tag v1.0.0
)

# Fake fork remote: soar = v1.0.0 plus two fork commits, soar-base = v1.0.0.
git init -q --bare "$ORIGIN"
git clone -q "$UP" "$WORK/seed"
(
  cd "$WORK/seed"
  git checkout -qb soar v1.0.0
  printf 'line one\nline two, changed by the fork\nline three\n' >src/a.ts
  commit_all 'feat: fork change to a.ts'
  sed -i 's/"zod": "3.0.0"/"zod": "3.0.0",\n    "fork-dep": "1.0.0"/' package.json
  printf 'lockfileVersion: 3\nleft-pad: 1.0.0\nzod: 3.0.0 fork-dep: 1.0.0\n' >package-lock.json
  commit_all 'feat: fork adds a dependency'
  git tag soar-base v1.0.0
  git push -q "$ORIGIN" soar main soar-base v1.0.0
)

new_clone() { # new_clone <dir>: a working clone of the fork, upstream added
  git clone -q -b soar "$ORIGIN" "$1"
  git -C "$1" remote add upstream "$UP"
  git -C "$1" fetch -q upstream --tags
}

echo "scenario: no new upstream release means nothing to do"
new_clone "$WORK/w1"
(
  cd "$WORK/w1"
  expect 0 "upstream-release.sh succeeds" "$SOAR_DIR/upstream-release.sh" "$UP"
  check "it reports mode=none" log_has 'mode=none'
  check "it reports the current release" log_has 'current=v1.0.0'
)

echo "scenario: a dry run against the current soar-base reproduces soar"
(
  cd "$WORK/w1"
  expect 0 "upstream-release.sh with the current tag asks for a dry run" "$SOAR_DIR/upstream-release.sh" "$UP" v1.0.0
  check "it reports mode=dry-run" log_has 'mode=dry-run'
  expect 0 "replay.sh onto soar-base succeeds" "$SOAR_DIR/replay.sh" v1.0.0
  check "sync/v1.0.0 has the same tree as soar" test "$(tree_of sync/v1.0.0)" = "$(tree_of soar)"
  check "sync/v1.0.0 has the same commits as soar" test "$(git rev-parse sync/v1.0.0)" = "$(git rev-parse soar)"
)

# Upstream release v1.1.0 bumps a dependency, touching the same lockfile line
# as the fork. A prerelease tag on top must be ignored.
(
  cd "$UP"
  sed -i 's/"left-pad": "1.0.0"/"left-pad": "1.1.0"/' package.json
  printf 'lockfileVersion: 3\nleft-pad: 1.1.0\nzod: 3.0.1\n' >package-lock.json
  commit_all 'upstream 1.1.0: bump dependencies'
  git tag v1.1.0
  echo 'rc' >rc.txt
  commit_all 'upstream 1.2.0-rc.1'
  git tag v1.2.0-rc.1
)

echo "scenario: a new release is found; prereleases are ignored"
(
  cd "$WORK/w1"
  git fetch -q upstream --tags
  expect 0 "upstream-release.sh succeeds" "$SOAR_DIR/upstream-release.sh" "$UP"
  check "it reports mode=sync" log_has 'mode=sync'
  check "it picks v1.1.0, not the prerelease" log_has 'target=v1.1.0'
  expect 2 "an older tag than soar-base is refused" "$SOAR_DIR/upstream-release.sh" "$UP" v0.9.0
  expect 2 "a prerelease tag is refused" "$SOAR_DIR/upstream-release.sh" "$UP" v1.2.0-rc.1
)

echo "scenario: a dependency bump that conflicts only in package-lock.json is not a conflict"
(
  cd "$WORK/w1"
  : >"$FAKE_NPM_LOG"
  expect 0 "replay.sh onto v1.1.0 succeeds" "$SOAR_DIR/replay.sh" v1.1.0
  check "no conflict is reported" bash -c "! grep -q 'replay: conflict' '$WORK/last.log'"
  check "npm regenerated the lockfile with --package-lock-only --ignore-scripts" \
    grep -qx 'install --package-lock-only --ignore-scripts' "$FAKE_NPM_LOG"
  git show sync/v1.1.0:package-lock.json >"$WORK/lock"
  check "the lockfile started from upstream's side" grep -qx 'zod: 3.0.1' "$WORK/lock"
  check "the fork's stale lockfile line was dropped" bash -c "! grep -q 'fork-dep' '$WORK/lock'"
  check "the lockfile was regenerated" grep -q '^regenerated-for: ' "$WORK/lock"
  git show sync/v1.1.0:package.json >"$WORK/pkg"
  check "package.json has upstream's bump" grep -q '"left-pad": "1.1.0"' "$WORK/pkg"
  check "package.json keeps the fork's dependency" grep -q '"fork-dep": "1.0.0"' "$WORK/pkg"
  check "the stack is two commits on v1.1.0" test "$(git rev-list --count v1.1.0..sync/v1.1.0)" = 2
  check "the fork commit messages are kept" bash -c "git log --format=%s v1.1.0..sync/v1.1.0 | grep -qx 'feat: fork adds a dependency'"
  git push -q origin sync/v1.1.0
)

echo "scenario: approve-and-promote, then a replay against the same tag reproduces the new soar"
(
  cd "$WORK/w1"
  old_soar="$(git rev-parse soar)"
  sync_head="$(git rev-parse sync/v1.1.0)"
  expect 2 "promote.sh refuses a target that is not newer than soar-base" "$SOAR_DIR/promote.sh" v1.0.0 sync/v1.0.0
  expect 2 "promote.sh refuses a sync ref not based on the target" "$SOAR_DIR/promote.sh" v1.1.0 soar
  check "the refusal names the missing base" log_has 'is not based on v1.1.0'
  expect 2 "promote.sh refuses when soar moved since the replay" \
    "$SOAR_DIR/promote.sh" v1.1.0 sync/v1.1.0 "$(git rev-parse v1.0.0)"
  check "the refusal says soar moved" log_has 'soar moved since'
  check "origin soar did not move" test "$(git --git-dir="$ORIGIN" rev-parse refs/heads/soar)" = "$old_soar"
  check "origin soar-base did not move" test "$(git --git-dir="$ORIGIN" rev-parse 'refs/tags/soar-base^{commit}')" = "$(git rev-parse 'v1.0.0^{commit}')"
  expect 1 "promote.sh rejects a replayed soar that is not a full SHA" "$SOAR_DIR/promote.sh" v1.1.0 sync/v1.1.0 no-such-ref
  expect 0 "promote.sh succeeds given the soar it replayed" "$SOAR_DIR/promote.sh" v1.1.0 sync/v1.1.0 "$old_soar"
  check "origin soar is the sync head" test "$(git --git-dir="$ORIGIN" rev-parse refs/heads/soar)" = "$sync_head"
  check "origin soar-base is v1.1.0" test "$(git --git-dir="$ORIGIN" rev-parse 'refs/tags/soar-base^{commit}')" = "$(git rev-parse 'v1.1.0^{commit}')"
  check "origin soar-archive/v1.0.0 is the old soar" test "$(git --git-dir="$ORIGIN" rev-parse 'refs/tags/soar-archive/v1.0.0^{commit}')" = "$old_soar"
  expect 2 "a second promote of the same release is refused" "$SOAR_DIR/promote.sh" v1.1.0 sync/v1.1.0
)
new_clone "$WORK/w2"
(
  cd "$WORK/w2"
  expect 0 "after promote, upstream-release.sh reports nothing to do" "$SOAR_DIR/upstream-release.sh" "$UP"
  check "it reports mode=none at v1.1.0" bash -c "grep -q 'mode=none' '$WORK/last.log' && grep -q 'current=v1.1.0' '$WORK/last.log'"
  : >"$FAKE_NPM_LOG"
  expect 0 "replay.sh onto the new soar-base succeeds" "$SOAR_DIR/replay.sh" v1.1.0
  check "the replay reproduces the new soar byte for byte" test "$(tree_of sync/v1.1.0)" = "$(tree_of soar)"
  check "npm was not needed" test ! -s "$FAKE_NPM_LOG"
)

# Upstream release v1.2.0 rewrites the line the fork changed.
(
  cd "$UP"
  printf 'line one\nline two, rewritten upstream\nline three\n' >src/a.ts
  commit_all 'upstream 1.2.0'
  git tag v1.2.0
)

echo "scenario: a real conflict exits 2 naming the file and the fork commit"
(
  cd "$WORK/w2"
  git fetch -q upstream --tags
  fork_commit="$(git log --format=%H --grep='fork change to a.ts' soar)"
  before="$(git rev-parse HEAD)"
  expect 2 "replay.sh onto v1.2.0 exits 2" "$SOAR_DIR/replay.sh" v1.2.0
  check "the report names the conflicting file" log_has 'src/a.ts'
  check "the report names the fork commit" log_has "$fork_commit"
  check "the report names the fork commit subject" log_has 'feat: fork change to a.ts'
  check "no rebase is left in progress" bash -c "! test -d \"\$(git rev-parse --git-path rebase-merge)\""
  check "the working tree is clean" test -z "$(git status --porcelain)"
  check "the original branch is checked out again" test "$(git rev-parse HEAD)" = "$before"
  check "no sync branch is left behind" bash -c "! git rev-parse -q --verify refs/heads/sync/v1.2.0"
)

echo "scenario: the guardrails compare a sync branch against its upstream release"
(
  cd "$WORK/w2"
  export SOAR_UPSTREAM_URL="$UP"
  git tag -f v1.2.0 soar >/dev/null # a fork-side tag impersonating the release
  expect 0 "sync-base.sh succeeds for sync/v1.2.0" "$SOAR_DIR/sync-base.sh" sync/v1.2.0
  check "it prints SOAR_BASE=v1.2.0" grep -qx 'SOAR_BASE=v1.2.0' "$WORK/last.log"
  check "the tag is upstream's, not the fork's" test "$(git rev-parse 'v1.2.0^{commit}')" = "$(git -C "$UP" rev-parse 'v1.2.0^{commit}')"
  expect 0 "sync-base.sh prints nothing for other branches" "$SOAR_DIR/sync-base.sh" feat/x
  check "the output is empty" test ! -s "$WORK/last.log"
  expect 1 "sync-base.sh refuses a malformed sync branch" "$SOAR_DIR/sync-base.sh" sync/main
  expect 1 "sync-base.sh refuses a release upstream does not have" "$SOAR_DIR/sync-base.sh" sync/v9.9.9
)

echo "scenario: replay.sh refuses to run on a dirty tree"
(
  cd "$WORK/w2"
  echo dirty >>src/a.ts
  expect 1 "replay.sh exits 1" "$SOAR_DIR/replay.sh" v1.2.0
  git checkout -q -- src/a.ts
)

PASS="$(grep -c '^pass$' "$RESULTS" || true)"
FAIL="$(grep -c '^fail$' "$RESULTS" || true)"
echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" = 0 ] && [ "$PASS" -gt 0 ]

#!/usr/bin/env bash
# Each scenario runs in its own subshell on purpose; its exports stay local.
# shellcheck disable=SC2030,SC2031
# Exercises the fork guardrails against throwaway git repositories.
#
# Every scenario builds a fresh repository in a temp directory, so this never
# touches the checkout it is run from. Requires git, python3 and gitleaks.
#
# The denylist logic is tested with a harmless canary value and a throwaway
# denylist file, so this script never spells out a guarded value. To also prove
# the real denylist, export SOAR_DENYLIST_PROBE=<a guarded value> before running.
set -euo pipefail

SOAR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CANARY='leak-canary.test'
CANARY_LIST="$WORK/canary-denylist.txt"
printf '# canary\n%s\n' "$(printf '%s' "$CANARY" | sha256sum | cut -d' ' -f1)" >"$CANARY_LIST"

# Scenarios run in subshells, so results are tallied in a file.
RESULTS="$WORK/results"
: >"$RESULTS"
ok() { echo pass >>"$RESULTS"; echo "  ok   - $1"; }
bad() { echo fail >>"$RESULTS"; echo "  FAIL - $1"; }

# expect <0|nonzero> <description> <command...>
expect() {
  local want="$1" desc="$2"
  shift 2
  local rc=0
  "$@" >"$WORK/last.log" 2>&1 || rc=$?
  if { [ "$want" = 0 ] && [ "$rc" = 0 ]; } || { [ "$want" = nonzero ] && [ "$rc" != 0 ]; }; then
    ok "$desc"
  else
    bad "$desc (exit $rc, wanted $want)"
    sed 's/^/        /' "$WORK/last.log"
  fi
}

git_q() { git -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false "$@"; }
git_husky0() { HUSKY=0 git_q "$@"; }

# new_repo <dir>: a repo whose first commit stands in for an upstream release,
# tagged soar-base, with branch soar checked out.
new_repo() {
  local dir="$1"
  git init -q -b main "$dir"
  (
    cd "$dir"
    mkdir -p packages/ee packages/lib/types packages/prisma/seed
    echo 'export const ee = 1;' >packages/ee/index.ts
    printf 'export const claims = {\n  cfr21: z.boolean().optional(),\n};\n' >packages/lib/types/subscription.ts
    echo 'upstream readme' >README.md
    git_q add -A
    git_q commit -qm 'upstream release'
    git_q tag soar-base
    git_q checkout -qb soar
  )
}

commit_file() { # commit_file <path> <content> [message]
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "$2" >"$1"
  git_q add -A
  git_q commit -qm "${3:-change $1}"
}

run_checks_clean() {
  "$SOAR_DIR/check-ee-untouched.sh" &&
    "$SOAR_DIR/check-enterprise-flags.sh" &&
    SOAR_DENYLIST_FILE="$CANARY_LIST" "$SOAR_DIR/check-denylist.sh"
}

echo "scenario: a clean branch passes every check"
new_repo "$WORK/clean"
(
  cd "$WORK/clean"
  commit_file README.md 'upstream readme, with a fork note'
  commit_file packages/lib/types/subscription.ts "$(printf 'export const claims = {\n  cfr21: z.boolean().optional(),\n  hipaa: z.boolean().optional(), // soar-allow-flag: schema field\n};')"
  commit_file packages/lib/server/new-thing.ts 'const cfr21Enabled = false;'
  commit_file packages/prisma/seed/flags.ts 'const claims = { cfr21: false };'
  expect 0 "ee, flags and denylist checks all pass" run_checks_clean
  expect 0 "divergence report exits 0" "$SOAR_DIR/divergence-report.sh"
  if grep -q 'README.md' "$WORK/last.log" && grep -q 'subscription.ts' "$WORK/last.log" && ! grep -q 'new-thing.ts' "$WORK/last.log"; then
    ok "divergence report lists modified upstream files only"
  else
    bad "divergence report lists modified upstream files only"
    sed 's/^/        /' "$WORK/last.log"
  fi
)

echo "scenario: a one-line change under packages/ee fails"
new_repo "$WORK/ee"
(
  cd "$WORK/ee"
  commit_file packages/ee/index.ts 'export const ee = 2;'
  expect nonzero "check-ee-untouched fails" "$SOAR_DIR/check-ee-untouched.sh"
  expect 0 "divergence report still exits 0" "$SOAR_DIR/divergence-report.sh"
)

# flag_case <0|nonzero> <content>: commit <content> on a fresh repo and run
# the flag check. SQL content goes in a migration, anything else in a seed.
flag_case() {
  local want="$1" content="$2"
  rm -rf "$WORK/flags"
  new_repo "$WORK/flags"
  (
    cd "$WORK/flags"
    case "$content" in
      UPDATE*) commit_file packages/prisma/migrations/20990101000000_x/migration.sql "$content" ;;
      *) commit_file packages/prisma/seed/flags.ts "$content" ;;
    esac
    if [ "$want" = 0 ]; then
      expect 0 "flag check passes on: $content" "$SOAR_DIR/check-enterprise-flags.sh"
    else
      expect nonzero "flag check fails on: $content" "$SOAR_DIR/check-enterprise-flags.sh"
    fi
  )
}

echo "scenario: enabling an Enterprise flag fails"
for line in \
  'const claims = { cfr21: true };' \
  '  "hipaa": true,' \
  'claims.emailDomains = true;' \
  "UPDATE \"SubscriptionClaim\" SET flags = jsonb_set(flags, '{authenticationPortal}', 'true');" \
  'const claims = { cfr21: on };' \
  '  hipaa: process.env.NEXT_PRIVATE_HIPAA === "true",' \
  '  cscQesSigning: enabled,' \
  '  instanceCscSigning: !0,' \
  'claims["hipaa"] = true;' \
  'if (claims.cfr21 === true) {' \
  'const claims = { cfr21: false, hipaa: true };' \
  'const q = { include: { emailDomains: true }, cfr21: on };'; do
  flag_case nonzero "$line"
done

echo "scenario: lines that do not enable an Enterprise flag pass"
for content in \
  'const claims = { cfr21: false };' \
  '  instanceCscSigning: false, // stays off' \
  'const org = await prisma.organisation.findFirst({ include: { emailDomains: true } });' \
  "$(printf 'const org = await prisma.organisation.findFirst({\n  select: {\n    id: true,\n    emailDomains: true,\n  },\n});')" \
  '  cfr21: true, // soar-allow-flag: test fixture, never deployed' \
  'if (claims.cfr21 === false) {'; do
  flag_case 0 "$content"
done

echo "scenario: a denylisted value fails the denylist check"
new_repo "$WORK/deny"
(
  cd "$WORK/deny"
  commit_file docs/x.md "see https://sign.$CANARY/path for details"
  expect nonzero "a subdomain of a denylisted domain in a file fails" \
    env SOAR_DENYLIST_FILE="$CANARY_LIST" "$SOAR_DIR/check-denylist.sh"
  if grep -q "$CANARY" "$WORK/last.log"; then bad "the finding does not echo the value"; else ok "the finding does not echo the value"; fi
)
new_repo "$WORK/deny-msg"
(
  cd "$WORK/deny-msg"
  commit_file docs/y.md 'harmless' "mention $CANARY in the message"
  expect nonzero "a denylisted value in a commit message fails" \
    env SOAR_DENYLIST_FILE="$CANARY_LIST" "$SOAR_DIR/check-denylist.sh"
)
# expect_refused <description> <command...>: the command fails and its output
# never contains the canary, in any case.
expect_refused() {
  local desc="$1"
  shift
  expect nonzero "$desc" "$@"
  if grep -qiF "$CANARY" "$WORK/last.log"; then
    bad "  ...and the output does not echo the value"
    sed 's/^/        /' "$WORK/last.log"
  else
    ok "  ...and the output does not echo the value"
  fi
}
deny_check() { SOAR_DENYLIST_FILE="$CANARY_LIST" "$SOAR_DIR/check-denylist.sh"; }

new_repo "$WORK/deny-path"
(
  cd "$WORK/deny-path"
  commit_file "docs/$CANARY/readme.md" 'harmless content'
  expect_refused "clean content under a denylisted path fails" deny_check
)
new_repo "$WORK/deny-binary"
(
  cd "$WORK/deny-binary"
  mkdir -p "img/$CANARY"
  printf '\000\001\002binary' >"img/$CANARY/logo.png"
  git_q add -A
  git_q commit -qm 'add a logo'
  expect_refused "a binary file under a denylisted path fails" deny_check
)
new_repo "$WORK/deny-empty"
(
  cd "$WORK/deny-empty"
  mkdir -p "keep/$CANARY"
  : >"keep/$CANARY/.gitkeep"
  git_q add -A
  git_q commit -qm 'add a placeholder'
  expect_refused "an empty file under a denylisted path fails" deny_check
)
new_repo "$WORK/deny-author"
(
  cd "$WORK/deny-author"
  printf 'x\n' >a.md
  git_q add -A
  git -c user.name=someone -c "user.email=someone@sign.$CANARY" -c commit.gpgsign=false commit -qm 'author change'
  expect_refused "a denylisted author email fails" deny_check
)
new_repo "$WORK/deny-committer"
(
  cd "$WORK/deny-committer"
  printf 'x\n' >a.md
  git_q add -A
  GIT_COMMITTER_EMAIL="ops@$CANARY" git_q commit -qm 'committer change'
  expect_refused "a denylisted committer email fails" deny_check
)
new_repo "$WORK/deny-case"
(
  cd "$WORK/deny-case"
  upper="$(printf '%s' "$CANARY" | tr '[:lower:]' '[:upper:]')"
  commit_file docs/case.md "Write to mail@sign.$upper. Or (see Sign.${upper,,}), thanks."
  expect_refused "mixed-case value with trailing punctuation fails" deny_check
)
new_repo "$WORK/deny-near"
(
  cd "$WORK/deny-near"
  commit_file docs/z.md "not-$CANARY and ${CANARY}x are different tokens"
  expect 0 "near-miss tokens do not match" env SOAR_DENYLIST_FILE="$CANARY_LIST" "$SOAR_DIR/check-denylist.sh"
)
if [ -n "${SOAR_DENYLIST_PROBE:-}" ]; then
  new_repo "$WORK/deny-real"
  (
    cd "$WORK/deny-real"
    commit_file docs/real.md "contact: someone@sign.${SOAR_DENYLIST_PROBE^^}."
    expect nonzero "the real denylist catches the probe value (any case, as a subdomain)" "$SOAR_DIR/check-denylist.sh"
  )
else
  echo "  skip - real denylist probe (set SOAR_DENYLIST_PROBE to run it)"
fi

echo "scenario: the pre-push hook refuses a leak, CI catches it when the hook is bypassed"
command -v gitleaks >/dev/null || { echo "gitleaks is required on PATH" >&2; exit 1; }
git init -q --bare "$WORK/remote.git"
REPO_GITLEAKS_CONFIG="$SOAR_DIR/../../.gitleaks.toml"
new_repo "$WORK/push"
(
  cd "$WORK/push"
  git remote add origin "$WORK/remote.git"
  # Commit the fork's own gitleaks config, so the hook scans with it.
  cp "$REPO_GITLEAKS_CONFIG" .gitleaks.toml
  git_q add .gitleaks.toml
  git_q commit -qm 'add gitleaks config'
  expect 0 "install-hooks.sh succeeds" "$SOAR_DIR/install-hooks.sh"
  export SOAR_DENYLIST_FILE="$CANARY_LIST"

  expect 0 "a clean branch pushes" git_q push -q origin soar main --tags

  git_q checkout -q -b a-clean soar
  commit_file docs/a.md 'clean change'
  git_q checkout -q -b b-leak soar
  commit_file docs/b.md "host: db.$CANARY"
  git_q checkout -q soar
  expect_refused "a push of several refs where a later ref leaks is refused" git_q push -q origin a-clean b-leak
  if git --git-dir="$WORK/remote.git" rev-parse -q --verify refs/heads/b-leak >/dev/null; then
    bad "the leaking ref never reaches the remote"
  else
    ok "the leaking ref never reaches the remote"
  fi

  expect_refused "a branch name containing a denylisted value is refused" \
    git_q push -q origin "soar:refs/heads/feature/$CANARY/onboarding"
  git_q tag -a v0-annotated -m "release notes for $CANARY" soar
  expect_refused "an annotated tag whose message has a denylisted value is refused" \
    git_q push -q origin v0-annotated
  git_q tag -d v0-annotated >/dev/null

  git_q checkout -qb leak
  commit_file docs/leak.md "endpoint: https://app.$CANARY"
  expect nonzero "the hook refuses a commit adding a denylisted value" git_q push -q origin leak
  if git --git-dir="$WORK/remote.git" rev-parse -q --verify refs/heads/leak >/dev/null; then
    bad "the refused commit never reaches the remote"
  else
    ok "the refused commit never reaches the remote"
  fi

  expect 0 "the same push with the hook bypassed goes through" git_q push -q --no-verify origin leak
  rm -rf "$WORK/ci"
  git clone -q -b leak "$WORK/remote.git" "$WORK/ci"
  expect nonzero "the CI denylist job fails on the bypassed push" \
    bash -c "cd '$WORK/ci' && '$SOAR_DIR/check-denylist.sh'"

  git_q checkout -q soar
  git_q checkout -qb secret
  token="ghp_$(python3 -c 'import secrets,string; print("".join(secrets.choice(string.ascii_letters+string.digits) for _ in range(36)))')"
  commit_file src/config.ts "const githubToken = \"$token\";"
  expect nonzero "the hook refuses a commit that gitleaks flags" git_q push -q origin secret
  # An uncommitted edit that allowlists the file must not change the verdict.
  cat >>.gitleaks.toml <<'TOML'

[allowlist]
paths = ['''src/config\.ts''']
TOML
  expect nonzero "the hook ignores an uncommitted gitleaks allowlist" git_q push -q origin secret
  git_q checkout -q -- .gitleaks.toml

  git_q checkout -q soar
  commit_file docs/fine.md 'a clean follow-up change'
  expect 0 "a clean follow-up push succeeds" git_q push -q origin soar
)

echo "scenario: the hook also runs when husky owns core.hooksPath, and with HUSKY=0"
rm -rf "$WORK/remote2.git"
git init -q --bare "$WORK/remote2.git"
new_repo "$WORK/husky"
(
  cd "$WORK/husky"
  git remote add origin "$WORK/remote2.git"
  # Mimic husky 9.1: core.hooksPath=.husky/_, whose stubs source .husky/_/h. It
  # skips every hook when HUSKY=0, then runs .husky/<hook> under sh -e.
  mkdir -p .husky/_
  cat >.husky/_/h <<'H'
#!/usr/bin/env sh
n=$(basename "$0")
s=$(dirname "$(dirname "$0")")/$n
[ ! -f "$s" ] && exit 0
i="${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh"
[ -f "$i" ] && . "$i"
[ "${HUSKY-}" = "0" ] && exit 0
sh -e "$s" "$@"
H
  for h in pre-push pre-commit; do
    # shellcheck disable=SC2016 # the stub must expand at hook time, not now
    printf '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n' >".husky/_/$h"
    chmod +x ".husky/_/$h"
  done
  # An upstream-style hook, to prove the other hooks still run through husky.
  # shellcheck disable=SC2016 # expands when the hook runs
  printf 'touch "$(git rev-parse --git-dir)/upstream-pre-commit-ran"\n' >.husky/pre-commit
  printf '/.husky/_/\n/.husky/pre-commit\n' >>.git/info/exclude
  git config core.hooksPath .husky/_

  expect 0 "install-hooks.sh succeeds under husky" "$SOAR_DIR/install-hooks.sh"
  if git status --porcelain | grep -q '.husky/pre-push'; then
    bad "the husky hook file stays out of git status"
  else
    ok "the husky hook file stays out of git status"
  fi
  expect 0 "install-hooks.sh warns when HUSKY=0 is set" env HUSKY=0 "$SOAR_DIR/install-hooks.sh"
  if grep -q 'HUSKY=0' "$WORK/last.log"; then ok "  ...and names HUSKY=0"; else bad "  ...and names HUSKY=0"; fi

  export SOAR_DENYLIST_FILE="$CANARY_LIST"
  expect 0 "a clean push succeeds under husky" git_q push -q origin soar
  commit_file docs/upstream-hook.md 'trigger pre-commit'
  if [ -e .git/upstream-pre-commit-ran ]; then
    ok "husky's other hooks still run"
  else
    bad "husky's other hooks still run"
  fi
  expect 0 "the clean commit pushes" git_q push -q origin soar
  commit_file docs/leak.md "mail.$CANARY"
  expect_refused "the hook refuses a leak under husky" git_q push -q origin soar
  expect_refused "the hook refuses a leak with HUSKY=0" git_husky0 push -q origin soar

  # npm install re-runs husky, which points core.hooksPath back at .husky/_.
  git config core.hooksPath .husky/_
  expect_refused "after npm install the husky shim still refuses the leak" git_q push -q origin soar
  expect 0 "re-running install-hooks.sh after npm install succeeds" "$SOAR_DIR/install-hooks.sh"
  expect_refused "and HUSKY=0 no longer skips the hook" git_husky0 push -q origin soar
)

PASS="$(grep -c '^pass$' "$RESULTS" || true)"
FAIL="$(grep -c '^fail$' "$RESULTS" || true)"
echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" = 0 ] && [ "$PASS" -gt 0 ]

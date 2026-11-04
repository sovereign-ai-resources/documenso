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
  commit_file packages/lib/types/subscription.ts "$(printf 'export const claims = {\n  cfr21: z.boolean().optional(),\n  hipaa: z.boolean().optional(),\n};')"
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

echo "scenario: enabling an Enterprise flag fails"
for line in \
  'const claims = { cfr21: true };' \
  '  "hipaa": true,' \
  'claims.emailDomains = true;' \
  "UPDATE \"SubscriptionClaim\" SET flags = jsonb_set(flags, '{authenticationPortal}', 'true');"; do
  rm -rf "$WORK/flags"
  new_repo "$WORK/flags"
  (
    cd "$WORK/flags"
    case "$line" in
      UPDATE*) commit_file packages/prisma/migrations/20990101000000_x/migration.sql "$line" ;;
      *) commit_file packages/prisma/seed/flags.ts "$line" ;;
    esac
    expect nonzero "flag check fails on: $line" "$SOAR_DIR/check-enterprise-flags.sh"
  )
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
new_repo "$WORK/push"
(
  cd "$WORK/push"
  git remote add origin "$WORK/remote.git"
  expect 0 "install-hooks.sh succeeds" "$SOAR_DIR/install-hooks.sh"
  export SOAR_DENYLIST_FILE="$CANARY_LIST"

  expect 0 "a clean branch pushes" git_q push -q origin soar main --tags

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

  git_q checkout -q soar
  commit_file docs/fine.md 'a clean follow-up change'
  expect 0 "a clean follow-up push succeeds" git_q push -q origin soar
)

echo "scenario: the hook also runs when husky owns core.hooksPath"
rm -rf "$WORK/remote2.git"
git init -q --bare "$WORK/remote2.git"
new_repo "$WORK/husky"
(
  cd "$WORK/husky"
  git remote add origin "$WORK/remote2.git"
  # Mimic husky 9: core.hooksPath=.husky/_ whose stubs run .husky/<hook> under sh -e.
  mkdir -p .husky/_
  # shellcheck disable=SC2016 # the stub must expand at hook time, not now
  printf '#!/usr/bin/env sh\nsh -e "$(dirname "$(dirname "$0")")/pre-push" "$@"\n' >.husky/_/pre-push
  chmod +x .husky/_/pre-push
  git config core.hooksPath .husky/_
  expect 0 "install-hooks.sh succeeds under husky" "$SOAR_DIR/install-hooks.sh"
  if git status --porcelain | grep -q '.husky/pre-push'; then
    bad "the husky hook file stays out of git status"
  else
    ok "the husky hook file stays out of git status"
  fi
  export SOAR_DENYLIST_FILE="$CANARY_LIST"
  expect 0 "a clean push succeeds under husky" git_q push -q origin soar
  commit_file docs/leak.md "mail.$CANARY"
  expect nonzero "the hook refuses a leak under husky" git_q push -q origin soar
)

PASS="$(grep -c '^pass$' "$RESULTS" || true)"
FAIL="$(grep -c '^fail$' "$RESULTS" || true)"
echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" = 0 ] && [ "$PASS" -gt 0 ]

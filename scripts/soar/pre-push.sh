#!/usr/bin/env bash
# Pre-push guard for this fork: runs gitleaks and the denylist on exactly the
# commits being pushed, and the denylist on the names of the refs being pushed
# and on any annotated tag objects. Refuses the push on any finding. CI runs
# the commit checks too, but only after the commits are already public, so this
# hook is the real gate. Installed by scripts/soar/install-hooks.sh; not run
# directly.
#
# Git calls it with <remote name> <remote url> and, on stdin, one line per ref:
#   <local ref> <local sha> <remote ref> <remote sha>
set -euo pipefail

remote="${1:-origin}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
zero="$(git hash-object --stdin </dev/null | tr '0-9a-f' '0')"
status=0

command -v gitleaks >/dev/null 2>&1 || {
  echo "soar pre-push: gitleaks is not on PATH; refusing to push unscanned commits." >&2
  echo "Install it (https://github.com/gitleaks/gitleaks/releases) and push again." >&2
  exit 1
}

# gitleaks picks the config parser from the file extension.
config_dir="$(mktemp -d)"
trap 'rm -rf "$config_dir"' EXIT
config_file="$config_dir/gitleaks.toml"

# Every command in the loop reads from /dev/null or a pipe of its own, so none
# of them can consume the ref list on stdin.
while read -r _local_ref local_sha remote_ref remote_sha; do
  [ -z "${local_sha:-}" ] && continue
  [ "$local_sha" = "$zero" ] && continue

  # The remote ref name is published as is. Never echo it until it is clean.
  if ! printf '%s\n' "$remote_ref" | "$here/check-denylist.sh" --text "the name of a ref being pushed"; then
    status=1
    continue
  fi

  # An annotated tag publishes its message and tagger; a tag may point at
  # another tag, so walk the chain down to the first non-tag object.
  obj="$local_sha"
  while [ "$(git cat-file -t "$obj" </dev/null)" = tag ]; do
    if ! git cat-file -p "$obj" </dev/null | "$here/check-denylist.sh" --text "the annotated tag $remote_ref"; then
      status=1
    fi
    obj="$(git cat-file -p "$obj" </dev/null | sed -n '1s/^object //p')"
  done

  if [ "$remote_sha" != "$zero" ] && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
    range=("$remote_sha..$local_sha")
  else
    # New ref, or a remote tip we do not have: scan what no remote-tracking
    # ref of this remote already contains.
    range=("$local_sha" --not "--remotes=$remote")
  fi

  [ -z "$(git rev-list -n1 "${range[@]}" </dev/null)" ] && continue

  echo "soar pre-push: scanning $remote_ref"
  if ! "$here/check-denylist.sh" "${range[@]}" </dev/null; then
    status=1
  fi

  # Scan with the gitleaks config committed in what is being pushed, never the
  # working tree's copy: an uncommitted allowlist must not pass a push that CI
  # would then fail after the commit is public.
  gitleaks_config=()
  if git cat-file -e "$local_sha^{commit}:.gitleaks.toml" 2>/dev/null; then
    git cat-file -p "$local_sha^{commit}:.gitleaks.toml" </dev/null >"$config_file"
    gitleaks_config=(--config "$config_file")
  fi
  if ! gitleaks git --no-banner --redact "${gitleaks_config[@]}" --log-opts="${range[*]}" . </dev/null; then
    echo "soar pre-push: gitleaks found a possible secret in what is pushed to $remote_ref" >&2
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "soar pre-push: push refused. Rewrite the offending commits, or rename the ref; this repo is public." >&2
fi
exit "$status"

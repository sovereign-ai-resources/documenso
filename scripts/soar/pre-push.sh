#!/usr/bin/env bash
# Pre-push guard for this fork: runs gitleaks and the denylist on exactly the
# commits being pushed, and refuses the push on any finding. CI runs the same
# checks, but only after the commits are already public, so this hook is the
# real gate. Installed by scripts/soar/install-hooks.sh; not run directly.
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

gitleaks_config=()
toplevel_config="$(git rev-parse --show-toplevel)/.gitleaks.toml"
[ -f "$toplevel_config" ] && gitleaks_config=(--config "$toplevel_config")

while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "${local_sha:-}" ] && continue
  [ "$local_sha" = "$zero" ] && continue

  if [ "$remote_sha" != "$zero" ] && git cat-file -e "$remote_sha^{commit}" 2>/dev/null; then
    range=("$remote_sha..$local_sha")
  else
    # New ref, or a remote tip we do not have: scan what no remote-tracking
    # ref of this remote already contains.
    range=("$local_sha" --not "--remotes=$remote")
  fi

  [ -z "$(git rev-list -n1 "${range[@]}")" ] && continue

  echo "soar pre-push: scanning $local_ref -> $remote_ref"
  if ! "$here/check-denylist.sh" "${range[@]}"; then
    status=1
  fi
  if ! gitleaks git --no-banner --redact "${gitleaks_config[@]}" --log-opts="${range[*]}" .; then
    echo "soar pre-push: gitleaks found a possible secret in $local_ref" >&2
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  echo "soar pre-push: push refused. Rewrite the offending commits; this repo is public." >&2
fi
exit "$status"

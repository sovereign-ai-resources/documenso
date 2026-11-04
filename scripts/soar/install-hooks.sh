#!/usr/bin/env bash
# Installs this fork's pre-push guard (gitleaks plus the denylist on the
# commits being pushed). Run it once per clone, and once per extra worktree,
# before the first push. Re-run it after the guard scripts or denylist change.
#
# How it coexists with husky: the repo's `prepare` script runs husky, which
# sets core.hooksPath=.husky/_ and regenerates that directory on every
# `npm install`. Husky's generated stubs run .husky/<hook> when that file
# exists. Until `npm install` has run, core.hooksPath is unset and git uses
# .git/hooks. So this installs both, and the guard works before and after
# `npm install`:
#   <git common dir>/soar-hooks/   a copy of the guard scripts and denylist,
#                                  independent of the branch checked out
#   <git common dir>/hooks/pre-push   used while core.hooksPath is unset
#   .husky/pre-push                used once husky owns core.hooksPath; kept
#                                  out of git via .git/info/exclude
set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
top="$(git rev-parse --show-toplevel)"
common="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
marker='# soar-fork pre-push guard'

hooks_path="$(git config --get core.hooksPath || true)"
case "$hooks_path" in
  '' | .husky/_ | .husky/_/ | "$top/.husky/_" | "$top/.husky/_/") ;;
  *)
    echo "install-hooks: core.hooksPath is '$hooks_path', which this installer does not manage." >&2
    echo "Add a pre-push hook there that runs: $common/soar-hooks/pre-push.sh \"\$@\"" >&2
    exit 1
    ;;
esac

command -v gitleaks >/dev/null 2>&1 ||
  echo "install-hooks: warning: gitleaks is not on PATH; pushes will be refused until it is." >&2

mkdir -p "$common/soar-hooks" "$common/hooks" "$common/info"
for f in pre-push.sh check-denylist.sh denylist.txt; do
  install -m "$([ "$f" = denylist.txt ] && echo 0644 || echo 0755)" "$src/$f" "$common/soar-hooks/$f"
done

write_shim() { # write_shim <path>
  local dest="$1"
  if [ -e "$dest" ] && ! grep -qF "$marker" "$dest"; then
    echo "install-hooks: $dest exists and is not ours; merge it by hand so it also runs:" >&2
    echo "  \"\$(git rev-parse --git-common-dir)/soar-hooks/pre-push.sh\" \"\$@\"" >&2
    return 1
  fi
  cat >"$dest" <<SHIM
#!/usr/bin/env sh
$marker (installed by scripts/soar/install-hooks.sh)
exec "\$(git rev-parse --git-common-dir)/soar-hooks/pre-push.sh" "\$@"
SHIM
  chmod 0755 "$dest"
  echo "install-hooks: wrote $dest"
}

write_shim "$common/hooks/pre-push"
mkdir -p "$top/.husky"
write_shim "$top/.husky/pre-push"

exclude="$common/info/exclude"
grep -qxF '/.husky/pre-push' "$exclude" 2>/dev/null || echo '/.husky/pre-push' >>"$exclude"

echo "install-hooks: pre-push guard installed."

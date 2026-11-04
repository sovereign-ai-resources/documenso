#!/usr/bin/env bash
# Installs this fork's pre-push guard (gitleaks plus the denylist on the
# commits and refs being pushed). Run it once per clone, and once per extra
# worktree, before the first push. Re-run it after every `npm install`, and
# after the guard scripts or denylist change.
#
# How it coexists with husky: the repo's `prepare` script runs husky, which
# sets core.hooksPath=.husky/_ and regenerates that directory on every
# `npm install`. Husky's stubs skip every hook when HUSKY=0 is set (or when
# ~/.config/husky/init.sh sets it), so the guard must not depend on them.
# This installs:
#   <git common dir>/soar-hooks/         a copy of the guard scripts and denylist,
#                                        independent of the branch checked out
#   <git common dir>/soar-hooks/hooks/   set as core.hooksPath: pre-push runs the
#                                        guard directly (HUSKY=0 cannot skip it);
#                                        every other hook chains to husky's stub
#                                        in .husky/_, or to <git common dir>/hooks
#                                        before `npm install` has created it
#   <git common dir>/hooks/pre-push      fallback if core.hooksPath is unset
#   .husky/pre-push                      fallback once `npm install` has pointed
#                                        core.hooksPath back at .husky/_ (HUSKY=0
#                                        skips this one); kept out of git via
#                                        .git/info/exclude
set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
top="$(git rev-parse --show-toplevel)"
common="$(cd "$(git rev-parse --git-common-dir)" && pwd)"
soar_hooks="$common/soar-hooks/hooks"
marker='# soar-fork pre-push guard'
# The client-side hooks husky 9 generates stubs for.
chained='applypatch-msg commit-msg post-applypatch post-checkout post-commit post-merge post-rewrite pre-applypatch pre-auto-gc pre-commit pre-merge-commit pre-rebase prepare-commit-msg'

hooks_path="$(git config --get core.hooksPath || true)"
case "$hooks_path" in
  '' | .husky/_ | .husky/_/ | "$top/.husky/_" | "$top/.husky/_/" | "$soar_hooks") ;;
  *)
    echo "install-hooks: core.hooksPath is '$hooks_path', which this installer does not manage." >&2
    echo "Add a pre-push hook there that runs: $common/soar-hooks/pre-push.sh \"\$@\"" >&2
    exit 1
    ;;
esac

command -v gitleaks >/dev/null 2>&1 ||
  echo "install-hooks: warning: gitleaks is not on PATH; pushes will be refused until it is." >&2

mkdir -p "$soar_hooks" "$common/hooks" "$common/info"
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
write_shim "$soar_hooks/pre-push"

for h in $chained; do
  cat >"$soar_hooks/$h" <<'CHAIN'
#!/usr/bin/env sh
# soar-fork hook chain (installed by scripts/soar/install-hooks.sh): runs
# husky's stub for this hook, or the classic hook before husky is installed.
n=$(basename "$0")
t=$(git rev-parse --show-toplevel 2>/dev/null) && [ -x "$t/.husky/_/$n" ] && exec "$t/.husky/_/$n" "$@"
c=$(git rev-parse --git-common-dir) && [ -x "$c/hooks/$n" ] && exec "$c/hooks/$n" "$@"
exit 0
CHAIN
  chmod 0755 "$soar_hooks/$h"
done

for f in "$common"/hooks/*; do
  [ -x "$f" ] || continue
  n="$(basename "$f")"
  case " $chained pre-push " in *" $n "*) continue ;; esac
  case "$n" in *.sample) continue ;; esac
  echo "install-hooks: warning: $f no longer runs once core.hooksPath is set; move it to $soar_hooks by hand." >&2
done

git config core.hooksPath "$soar_hooks"
echo "install-hooks: core.hooksPath is now $soar_hooks"

exclude="$common/info/exclude"
grep -qxF '/.husky/pre-push' "$exclude" 2>/dev/null || echo '/.husky/pre-push' >>"$exclude"

if [ "${HUSKY-}" = 0 ]; then
  cat >&2 <<'WARN'

install-hooks: WARNING: HUSKY=0 is set in this environment.
  The guard installed above still runs, but `npm install` points core.hooksPath
  back at .husky/_, and husky's stubs skip every hook when HUSKY=0. Re-run this
  installer after every `npm install`, and never push with HUSKY=0 otherwise.
WARN
fi
husky_init="${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh"
if [ -f "$husky_init" ]; then
  echo "install-hooks: warning: $husky_init exists; if it sets HUSKY=0 or exits, husky skips the .husky/pre-push fallback." >&2
fi

echo "install-hooks: pre-push guard installed. Re-run this after every npm install."

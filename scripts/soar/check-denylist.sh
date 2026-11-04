#!/usr/bin/env bash
# Fails when commits add a denylisted value (see denylist.txt).
#
# Usage: check-denylist.sh [<git rev-list arguments>...]
#   Default range: <base>..HEAD, where <base> is $SOAR_BASE or the tag soar-base.
#   Scans, for every commit in the range: author and committer names and
#   emails, the commit message, and every added line and new file path.
#   Binary file contents are not scanned.
#
# Env: SOAR_DENYLIST_FILE overrides the hash list (used by the tests).
# Findings name the commit and file but never echo the matched value, since CI
# logs on a public repo are public.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
list="${SOAR_DENYLIST_FILE:-$here/denylist.txt}"
[ -r "$list" ] || { echo "denylist: cannot read $list" >&2; exit 2; }

if [ "$#" -eq 0 ]; then
  base="${SOAR_BASE:-soar-base}"
  git rev-parse -q --verify "$base^{commit}" >/dev/null || {
    echo "denylist: base '$base' not found (fetch tags, or set SOAR_BASE)" >&2
    exit 2
  }
  set -- "$base..HEAD"
fi

# Commits to scan, oldest first. An empty range is a pass.
mapfile -t commits < <(git rev-list --reverse "$@")
[ "${#commits[@]}" -eq 0 ] && { echo "denylist: no commits to scan"; exit 0; }

{
  for c in "${commits[@]}"; do
    printf '\0COMMIT %s\n' "$c"
    git show -s --format='%an%n%ae%n%cn%n%ce%n%B' "$c"
    printf '\0DIFF\n'
    git show --format= --no-color --no-renames --unified=0 --no-ext-diff "$c"
  done
} | python3 -I -c '
import hashlib, re, sys

hashes = set()
with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        line = line.strip().lower()
        if line and not line.startswith("#"):
            hashes.add(line)

token_re = re.compile(r"[A-Za-z0-9._-]+")

def hits(text):
    for tok in token_re.findall(text):
        tok = tok.strip("._-").lower()
        while tok:
            if hashlib.sha256(tok.encode()).hexdigest() in hashes:
                return True
            _, dot, rest = tok.partition(".")
            tok = rest if dot else ""
    return False

found = 0
commit, part, path = "?", "meta", "?"
for raw in sys.stdin.buffer:
    line = raw.decode("utf-8", "replace").rstrip("\n")
    if line.startswith("\0COMMIT "):
        commit, part, path = line[8:], "meta", "?"
        continue
    if line == "\0DIFF":
        part = "diff"
        continue
    if part == "meta":
        if hits(line):
            print(f"denylist: commit {commit[:12]}: author, committer or message contains a denylisted value")
            found += 1
        continue
    if line.startswith("+++ "):
        p = line[4:]
        p = p[2:] if p.startswith("b/") else p
        path = "<path redacted>" if hits(p) else p
        if path == "<path redacted>":
            print(f"denylist: commit {commit[:12]}: a file path contains a denylisted value")
            found += 1
        continue
    if line.startswith("+") and hits(line[1:]):
        print(f"denylist: commit {commit[:12]}: {path}: an added line contains a denylisted value")
        found += 1

if found:
    print(f"denylist: {found} finding(s). Remove the value from the commits (rewrite them); do not just add a fix-up commit, the history is public.")
    sys.exit(1)
print("denylist: clean")
' "$list"

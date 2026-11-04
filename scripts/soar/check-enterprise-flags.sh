#!/usr/bin/env bash
# Fails if the branch adds a line that turns on a Documenso Enterprise
# feature flag (in a seed, a migration, or code). Upstream's own definitions
# of these flags are not flagged: only lines this branch adds relative to the
# upstream release are inspected.
#
# Usage: check-enterprise-flags.sh [<base>]   (default: $SOAR_BASE or tag soar-base)
set -euo pipefail

base="${1:-${SOAR_BASE:-soar-base}}"
git rev-parse -q --verify "$base^{commit}" >/dev/null || {
  echo "enterprise-flags: base '$base' not found (fetch tags, or set SOAR_BASE)" >&2
  exit 2
}

flags='cfr21|instanceCscSigning|authenticationPortal|emailDomains|hipaa|cscQesSigning'

# This script and its test necessarily contain the patterns they look for.
git diff --no-color --no-renames --unified=0 --no-ext-diff "$base" HEAD -- . \
  ':(exclude)scripts/soar/check-enterprise-flags.sh' \
  ':(exclude)scripts/soar/test-guardrails.sh' |
  awk -v flags="$flags" '
    BEGIN {
      # flag: true, "flag": true, flag = true, flag=true, flag: !0
      assign = "(^|[^A-Za-z0-9_])(" flags ")[\"'\'']?[[:space:]]*(:|=|===?)[[:space:]]*(true|!0)([^A-Za-z0-9_]|$)"
      # SQL or JSON patches that name a flag and set true on the same line
      named = "(^|[^A-Za-z0-9_])(" flags ")([^A-Za-z0-9_]|$)"
      found = 0
    }
    /^\+\+\+ / { path = substr($0, 5); sub(/^b\//, "", path); next }
    /^\+/ {
      line = substr($0, 2)
      sqlish = (path ~ /\.sql$/ || path ~ /(^|\/)migrations?\//)
      if (line ~ assign || (sqlish && line ~ named && tolower(line) ~ /true/)) {
        printf "enterprise-flags: %s: %s\n", path, line
        found++
      }
    }
    END {
      if (found) {
        print "This fork never enables Documenso Enterprise features. Remove the line(s) above."
        exit 1
      }
      print "enterprise-flags: no added line enables an Enterprise flag"
    }'

#!/usr/bin/env bash
# Fails if the branch adds a line that could turn on a Documenso Enterprise
# feature flag (in a seed, a migration, or code). Upstream's own definitions
# of these flags are not flagged: only lines this branch adds relative to the
# upstream release are inspected.
#
# An added line fails when it:
#   - assigns a flag (`flag: value` or `flag = value`) anything but a literal
#     `false`. Aliases and derived values (`cfr21: on`,
#     `hipaa: process.env.X === "true"`) fail too, since the check cannot tell
#     what they evaluate to;
#   - compares a flag with `true` or `!0` (`claims.cfr21 === true`);
#   - in a .sql file or a migrations directory, names a flag and contains `true`.
# Not flagged: a Prisma `include: { ... }` or `select: { ... }` object, where
# `emailDomains: true` loads the relation of that name, and any line carrying
# a `soar-allow-flag` annotation (say why in the same comment, for review).
#
# Usage: check-enterprise-flags.sh [<base>]   (default: $SOAR_BASE or tag soar-base)
set -euo pipefail

base="${1:-${SOAR_BASE:-soar-base}}"
git rev-parse -q --verify "$base^{commit}" >/dev/null || {
  echo "enterprise-flags: base '$base' not found (fetch tags, or set SOAR_BASE)" >&2
  exit 2
}

flags='cfr21|instanceCscSigning|authenticationPortal|emailDomains|hipaa|cscQesSigning'

git diff --no-color --no-renames --unified=0 --no-ext-diff "$base" HEAD -- . \
  ':(exclude)scripts/soar/check-enterprise-flags.sh' \
  ':(exclude)scripts/soar/test-guardrails.sh' |
  awk -v flags="$flags" '
    function count(s, re,   n) { n = gsub(re, "", s); return n }
    # enables(text): 1 if text assigns a flag anything but false, or compares
    # a flag with true. Checks every flag occurrence on the line.
    function enables(text,   m, op, rest, v) {
      while (match(text, use)) {
        m = substr(text, RSTART, RLENGTH)
        rest = substr(text, RSTART + RLENGTH)
        op = m; sub(/^.*[^=:]/, "", op)
        v = rest
        sub(/^[[:space:]]+/, "", v)
        if (op == ":" || op == "=") {
          sub(/(\/\/|\/\*|[,;})]).*$/, "", v)
          sub(/[[:space:]]+$/, "", v)
          if (v != "false") return 1
        } else if (v ~ /^(true|!0)([^A-Za-z0-9_]|$)/) {
          return 1
        }
        text = rest
      }
      return 0
    }
    BEGIN {
      use = "(^|[^A-Za-z0-9_])(" flags ")[\"'\'']?]?[[:space:]]*(===?|:|=)"
      named = "(^|[^A-Za-z0-9_])(" flags ")([^A-Za-z0-9_]|$)"
      prisma = "(^|[^A-Za-z0-9_])(include|select)[[:space:]]*:[[:space:]]*[{]"
      closed = "(^|[^A-Za-z0-9_])(include|select)[[:space:]]*:[[:space:]]*[{][^{}]*[}]"
      found = 0; depth = 0
    }
    /^\+\+\+ / { path = substr($0, 5); sub(/^b\//, "", path); depth = 0; next }
    /^@@/ { depth = 0; next }
    /^\+/ {
      line = substr($0, 2)
      check = line
      if (depth > 0) {
        # Inside a multi-line include/select object begun on an added line.
        depth += count(line, "[{]") - count(line, "[}]")
        if (depth < 0) depth = 0
        check = ""
      } else {
        # Drop closed include/select objects (innermost first), then anything
        # after one that stays open past the end of the line.
        while (match(check, closed)) {
          check = substr(check, 1, RSTART) substr(check, RSTART + RLENGTH)
        }
        if (match(check, prisma)) {
          depth = count(substr(check, RSTART), "[{]") - count(substr(check, RSTART), "[}]")
          check = substr(check, 1, RSTART)
        }
      }
      if (line ~ /soar-allow-flag/) next
      sqlish = (path ~ /\.sql$/ || path ~ /(^|\/)migrations?\//)
      if (enables(check) || (sqlish && line ~ named && tolower(line) ~ /true/)) {
        printf "enterprise-flags: %s: %s\n", path, line
        found++
      }
    }
    END {
      if (found) {
        print "This fork never enables Documenso Enterprise features. Remove the line(s) above,"
        print "or, if a line does not enable a flag, mark it: // soar-allow-flag: <why>"
        exit 1
      }
      print "enterprise-flags: no added line enables an Enterprise flag"
    }'

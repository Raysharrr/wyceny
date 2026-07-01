#!/usr/bin/env bash
set -euo pipefail

# F-9 fitness function: no PII / secrets committed to version control.
#
# Scans every git-TRACKED file (never node_modules/.git/untracked scratch)
# for:
#   - Polish PESEL numbers        (11 consecutive digits)
#   - Land-register (KW) numbers  (format: 2 letters + digit + letter,
#     "/", 8 digits, "/", digit — e.g. WA1M / 00012345 / 6. Written here
#     with spaces so this comment doesn't trip its own regex.)
#   - Committed akt/operat PDFs   (signed deeds / valuation reports)
#
# Exits 0 when clean. Exits 1, printing "file:line: match", when something
# is found.

cd "$(git rev-parse --show-toplevel)"

# Generated/lock files legitimately contain long digit/hash runs that are
# NOT PII — excluded so the scan stays signal, not noise. `git grep`
# already only looks at tracked files (or `--no-index` matches would also
# include working-tree cruft), so untracked scratch is never scanned.
EXCLUDE_PATHSPECS=(
  ':(exclude)pnpm-lock.yaml'
  ':(exclude)apps/worker/uv.lock'
  ':(exclude)apps/web/drizzle/meta/*.json'
  ':(exclude).superpowers/**'
)

fail=0

echo "F-9: scanning git-tracked files for PII/secrets..."

# -I  : skip binary files
# -n  : print line numbers
# -P  : Perl regex (needed for \b word boundaries — git's built-in ERE
#       engine on some platforms, e.g. Apple Git, doesn't support \b)
#
# `git grep` exits 1 when there are simply no matches (not an error) and
# >1 on a real error (bad pattern, git failure, etc). Only treat exit 1 as
# "clean" — anything else must abort loudly instead of silently reporting
# a false "F-9 OK".
grep_tracked() {
  local out rc
  out="$(git grep -nIP "$1" -- . "${EXCLUDE_PATHSPECS[@]}" 2>&1)" && rc=0 || rc=$?
  if (( rc > 1 )); then
    echo "F-9: git grep failed unexpectedly (exit $rc): $out" >&2
    exit 2
  fi
  printf '%s' "$out"
}

pesel_hits="$(grep_tracked '\b[0-9]{11}\b')"
if [[ -n "$pesel_hits" ]]; then
  echo ""
  echo "PESEL-like number(s) (11 consecutive digits) found:"
  echo "$pesel_hits"
  fail=1
fi

kw_hits="$(grep_tracked '[A-Z]{2}[0-9][A-Z]/[0-9]{8}/[0-9]')"
if [[ -n "$kw_hits" ]]; then
  echo ""
  echo "Land-register (KW) number(s) found:"
  echo "$kw_hits"
  fail=1
fi

# Committed akt/operat PDFs: check filenames, not content — these are
# binary documents that should never be tracked at all.
pdf_hits="$(git ls-files -- '*.pdf' "${EXCLUDE_PATHSPECS[@]}" 2>/dev/null | grep -iE '(akt|operat)' || true)"
if [[ -n "$pdf_hits" ]]; then
  echo ""
  echo "Committed akt/operat PDF(s) found (must never be in VCS):"
  echo "$pdf_hits"
  fail=1
fi

if [[ "$fail" -eq 1 ]]; then
  echo ""
  echo "F-9 FAILED: PII/secrets detected in tracked files."
  exit 1
fi

echo "F-9 OK: no PII/secrets detected in tracked files."
exit 0

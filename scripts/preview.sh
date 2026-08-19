#!/usr/bin/env bash
# Talk to a protected Vercel preview deployment.
#
# Preview deployments sit behind Vercel Authentication, so a plain curl gets a
# 302 to an SSO page and any automated check is blind. Vercel's answer is
# "Protection Bypass for Automation": one project-level secret, sent as a
# header. This wraps that so nobody has to remember the header name.
#
#   ./scripts/preview.sh /login
#   ./scripts/preview.sh /api/health -i
#   PREVIEW_URL=https://... ./scripts/preview.sh /
#
# One-time setup (needs a Vercel account with rights on the project's team):
#   vercel project protection enable wyceny --protection-bypass --scope <team>
# then put the printed secret in apps/web/.env.local (gitignored):
#   VERCEL_AUTOMATION_BYPASS_SECRET=...
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# .env.local is gitignored; F-9 keeps secrets out of the repo, so this is the
# only place the secret may live locally.
if [[ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" && -f "$ROOT/apps/web/.env.local" ]]; then
  VERCEL_AUTOMATION_BYPASS_SECRET="$(grep -m1 '^VERCEL_AUTOMATION_BYPASS_SECRET=' "$ROOT/apps/web/.env.local" | cut -d= -f2- | tr -d '"'"'"'' || true)"
fi

if [[ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then
  cat >&2 <<'MSG'
VERCEL_AUTOMATION_BYPASS_SECRET is not set.

Generate it once (needs rights on the project's Vercel team):
  vercel project protection enable wyceny --protection-bypass --scope <team>

Then add it to apps/web/.env.local (gitignored) and, for CI, to the repo's
GitHub secrets under the same name.
MSG
  exit 1
fi

if [[ -z "${PREVIEW_URL:-}" ]]; then
  # Default to the branch's own preview alias — the shape Vercel gives a PR.
  BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD | tr '/_.' '-')"
  PREVIEW_URL="https://wyceny-git-${BRANCH}-make-it-simple.vercel.app"
fi

PATH_PART="${1:-/}"
shift || true

exec curl -sS \
  -H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}" \
  -H "x-vercel-set-bypass-cookie: true" \
  "$@" "${PREVIEW_URL}${PATH_PART}"

# Handoff — wyceny (after Slice 0: walking skeleton)

> **Purpose:** let an agent (or human) in a future session start with full context — what
> is built and where, what to do next, and the hard-won gotchas. Read this + the
> [README](../README.md) + [docs/architecture/](architecture/) + the **wiki** roadmap.

## TL;DR

Slice 0 (walking skeleton) is **done, deployed, and live**. The thinnest E2E through every
architectural boundary works in production. The valuation engine, document, and AI are
**stubs**. Next up: the **KCS valuation engine** slice. Resume delivery by invoking the
`/build-slice` skill (it reads the NOW item from the wiki roadmap and runs the SDD cycle).

## Two repos (know which is which)

|                                       | Repo                            | Local                      | Role                                                                                                                                                                                |
| ------------------------------------- | ------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wiki** (knowledge / command center) | `make-it-simple-rayshar/wyceny` | `~/Development/wyceny`     | Roadmap, ADRs, PRD, plans (`docs/superpowers/`), skills (`plan-pipeline`, `build-slice`), SDD ledger (`.superpowers/sdd/`). **`main` is PROTECTED — requires PR + signed commits.** |
| **App** (code — THIS repo)            | `Raysharrr/wyceny`              | `~/Development/wyceny-app` | Monorepo (pnpm + Turborepo): `apps/web` (Next 16 → Vercel) + `apps/worker` (FastAPI → Railway) + `packages/shared`.                                                                 |

`CLAUDE.md` in both repos cross-links. Product decisions land in the **wiki** first (ADR),
then code here.

## What's live (production)

- **Web:** https://wyceny-mu.vercel.app (Vercel, project `make-it-simple/wyceny`)
- **Worker:** https://worker-production-c672.up.railway.app (Railway; `POST /amount-in-words`, `GET /health`)
- **Postgres:** Railway (migrated + seeded, with RLS role `app_role`)
- **Demo users:** `aneta@wyceny.test` / `Admin123!` (admin) · `zenon@wyceny.test` / `Rzeczoznawca123!` (appraiser)

Verified E2E in prod: login → create valuation → worker computes amount-in-words → doc
stored (pg) + served with ownership auth → list with role isolation → view.

## Conventions (IMPORTANT — enforced)

- **Language:** all **code / DB / comments / identifiers = ENGLISH**; **UI copy = POLISH**
  (full diacritics). (This reversed an earlier "Polish domain vocabulary / ubiquitous
  language" decision — done in the iteration session.)
- **Domain vocabulary (English):** entity `Valuation` (table `valuation`), role
  `appraiser` | `admin`, status `in_progress` | `signed`, worker `/amount-in-words`,
  column `amount_in_words`, routes `/valuations`. The UI **displays** these in Polish
  (e.g. role `appraiser` → label "rzeczoznawca", status `in_progress` → "W toku").
- **Hexagonal (ADR-008/010):** pure `domain/` (no I/O), `ports/` (contracts), adapters
  wired **only** at the app layer (`app/valuations/_deps.ts`). Enforced by F-10.
- **Fitness functions in CI from day 1** (`.github/workflows/ci.yml`): F-1 golden harness,
  F-8 ownership/RLS, F-9 no-PII-in-VCS, F-10 dependency rule, F-11 worker-returns-words-only.

## Deploy / infra — the real picture (read before deploying)

- **Vercel (web): git-connected.** Merge to `main` → auto-deploys **production**. Two
  project settings were required for the monorepo (set once, via the Vercel API):
  **Root Directory = `apps/web`** and **Build Command = `next build`** (Vercel otherwise
  built from the repo root / auto-picked `turbo run build` and failed).
  Env vars (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `WORKER_URL`) must be set for **both
  Production AND Preview** — Preview builds fail with "DATABASE_URL is not set" otherwise
  (the `/api/auth/[...all]` route imports the db client at build time).
- **Railway (worker + Postgres): NOT git-connected.** The worker is deployed **manually**:
  `cd apps/worker && railway up -c -p <projectId> -s <serviceId> -e <envId> -m "..."`.
  So **worker code changes need a manual redeploy after merge.** The Railway **MCP**
  auth expires often — prefer the **CLI** (`railway up`, `railway whoami`). Worker build
  config: `apps/worker/railway.json` (nixpacks + uvicorn start) + `requirements.txt`.
- **Prod DB migrations:** from `apps/web`,
  `DATABASE_URL=<Railway DATABASE_PUBLIC_URL> pnpm exec drizzle-kit migrate` (public proxy
  URL is in the Postgres service's Railway variables; the internal `railway.internal` URL
  is unreachable from outside).
- **Schema-changing releases:** migrate prod DB **first**, then deploy worker + web
  **together** (there are no endpoint/column aliases — an out-of-sync rollout breaks
  valuation creation). No real traffic yet, so a brief inconsistency window is fine.
- **Secrets:** the auto-mode guard blocks raw secrets in Bash command lines and
  destructive git (`reset --hard`); the owner grants per-action or runs the step. Prod
  secrets belong in Vercel/Railway env, never in the repo (F-9).

## What's next (in order)

1. **KCS valuation engine slice** (wiki roadmap NOW): the real _Kwota Cen Średnich_
   comparative-approach engine — deterministic, golden-tested (**F-1** = `1 044 400`),
   determinism (**F-2**), reproducibility (**F-3**). Replaces `stubWr`
   (`app/actions/create-valuation.ts`). The proven spike is in the wiki
   (`tools/spike/2026-05-14-kcs/`). Run via `/build-slice`.
2. Then per roadmap NEXT: subject data + provenance snapshot; `Sourced<T>` gating
   (`to_verify`/`none` blocks approval — F-4); features/weights (ADR-006 preset weights);
   document generator (docxtemplater + PDF); immutability + audit_log + sign (F-7).

## Open backlog (this app repo)

Mostly cleared during the iteration session. Still open:

- **RLS is SELECT-only** — add INSERT/UPDATE policies + role-switch on writes when the
  first real mutation/sign endpoint lands. (Today's only write, `create`, goes through the
  app layer; no exposed mutation beyond it.)
- The stubbed engine/document/AI are **next slices**, not backlog.

Full per-task history + backlog: wiki `.superpowers/sdd/progress.md`.

## Pending on the human/owner side (needs ADMIN / signing key)

1. **Branch protection on `Raysharrr/wyceny`** — the automation's `gh` account has only
   WRITE; the owner must enable: require PR + status check `ci` (Settings → Branches).
2. **Commit signing** — a dedicated SSH signing key (the existing key is "already in use"
   as an auth key) → unblocks the wiki PR (Slice 0 docs + `build-slice` skill + planning
   history), which is blocked by the wiki's "require signed commits" rule.
3. **Merge the wiki PR** once signed.

## How to resume (future agent)

1. Read: this file → app `README.md` → `docs/architecture/` → wiki `roadmap.md` (NOW item)
   - the auto-loaded project memory.
2. To build the next slice: invoke **`/build-slice`** — it reads the wiki roadmap NOW item
   and runs the delivery cycle (brainstorm → writing-plans → subagent-driven-development
   TDD → CI + fitness functions → deploy → docs).
3. SDD ledger (per-task history + backlog): wiki `.superpowers/sdd/progress.md`.

## Gotchas learned this session (feed these into `build-slice`)

- **Vercel monorepo:** Root Directory + Build Command + **Preview** env vars (not just
  Production) — otherwise preview deploys fail on every PR.
- **Railway:** worker via `railway up` CLI (MCP auth flakes); worker not git-connected →
  manual redeploy; migrate against the **public** proxy URL.
- **Schema refactor on a live DB:** rename via an **idempotent** migration (IF EXISTS +
  WHERE-scoped data UPDATEs — `drizzle-kit` can crash on a combined table+column rename, so
  hand-write it), apply to prod first, then coordinate worker + web deploy.
- **Subagent dispatch:** a subagent must **execute**, not re-delegate; a flaky
  re-delegation spawned an orphan agent that later collided on files. Give explicit
  "do NOT delegate" and verify the working tree after.
- **Editor diagnostics lag** after renames/moves — trust `pnpm --filter web typecheck`
  (green) + `git ls-files`, not the editor's stale "cannot find module".

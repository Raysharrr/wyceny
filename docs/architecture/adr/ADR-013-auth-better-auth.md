# ADR-013 — Auth = Better Auth behind PortAuth

> Canonical record (Polish, full detail): [`wiki/decisions/ADR-013-auth-better-auth.md`](https://github.com/make-it-simple-rayshar/wyceny/blob/main/wiki/decisions/ADR-013-auth-better-auth.md) in the wiki repo. This file is a developer-facing English summary — the wiki is canonical.

**Status:** active · **Date:** 2026-07-01

## Decision

Authentication is **Better Auth** (self-hosted, TypeScript, Drizzle adapter, sessions in our own Postgres), conceptually behind a `PortAuth` ACL. Authorization (who can see which valuation) is **domain logic, not database RLS** — admins see all, appraisers see only their own — enforced at the use-case/repository level. Postgres Row-Level Security is added as **defense-in-depth** on top of the app-layer check, not as the primary authorization mechanism. File/document access control is **app-layer** (ownership check before serving), not storage-provider RLS.

## Why

Supabase Auth (managed, bundled RLS) was considered and rejected: its main advantage — turnkey storage/table RLS via Supabase JWTs — doesn't actually apply here, because authorization is domain-level (role + ownership), not something a generic RLS policy alone can express, and Supabase's storage-RLS specifically requires Supabase-issued JWTs that a Better Auth session doesn't produce. Better Auth wins on the drivers that matter most here: Drizzle-native, type-safe end-to-end, testable locally with no external service, no second vendor in the critical path — proportional to ~5 trusted internal users, not a multi-tenant SaaS threat model.

## How it maps to this repo

- `apps/web/src/auth/auth.ts` — Better Auth server instance, Drizzle adapter, custom `role` field (`admin | appraiser`) on `user`, public sign-up disabled (closed system).
- `apps/web/src/auth/session.ts` — `getSession()` helper used by Server Components, Server Actions, and Route Handlers.
- `apps/web/src/adapters/valuation-drizzle.ts` — **two-layer** ownership enforcement:
  1. **App-layer** (primary, always correct): `listForUser` branches on role; `get`/`getByDocKey` re-check ownership after fetch (`canSee()`).
  2. **Postgres RLS** (defense-in-depth): the app connects as a superuser by default (which bypasses RLS), so every read runs inside a transaction that switches to the non-superuser `app_role` via `SET LOCAL ROLE` and sets `app.user_id`/`app.role` via `set_config(..., true)` — transaction-scoped, pooling-safe. Policy defined in `drizzle/0003_wycena_rls.sql`, renamed onto `valuation` by `drizzle/0005_english_domain_rename.sql`.
- `apps/web/src/app/api/docs/[key]/route.ts` — app-layer file access control: requires a session, then requires the requesting user to own (or, as admin, be allowed to see) the `Valuation` that references this document key. No session → 401; no visible owning valuation → 404 (same 404 whether the doc doesn't exist or just isn't theirs — no existence leak).

This is fitness function **F-8** (ownership isolation), CI-enforced via `apps/web/tests/rls-isolation.test.ts` (a raw-SQL test that bypasses the app-layer filter to prove the DB-level RLS policy independently blocks cross-owner reads) and `apps/web/tests/docs-route.test.ts`.

## Current state vs. plan

Fully implemented and deployed as designed: Better Auth + two-layer ownership (app-layer + Postgres RLS defense-in-depth) + app-layer file authz on `/api/docs/[key]`. Storage backend is currently Postgres (`storage-pg.ts`, plain-text `document` table) rather than S3/R2 as the ADR's storage discussion leaned toward — an accepted interim choice behind `PortStorage`, swappable without touching callers.

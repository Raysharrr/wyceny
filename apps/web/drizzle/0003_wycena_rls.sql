-- Ownership isolation defense-in-depth (F-8, ADR-013).
--
-- Hand-written, not `drizzle-kit generate`d: CREATE ROLE / GRANT / FORCE ROW
-- LEVEL SECURITY aren't expressible via the installed drizzle-orm pg-core
-- schema DSL version in this repo (only `.enableRLS()`/`pgPolicy`/`pgRole`
-- exist, none cover FORCE or GRANT). Intentionally not mirrored in
-- `schema.ts` either, so `schema.ts` (the source drizzle-kit diffs against)
-- stays free of drift — future `drizzle-kit generate` runs won't try to
-- revert or duplicate this migration.
--
-- Why a dedicated role: the app connects to Postgres as the `postgres`
-- superuser (see docker-compose.yml). Superusers ALWAYS bypass Postgres RLS
-- regardless of ENABLE/FORCE ROW LEVEL SECURITY, so without a non-superuser
-- role to run isolated queries as, RLS would be a silent no-op. `app_role`
-- is NOLOGIN — it is only ever reached via `SET LOCAL ROLE` from the
-- superuser connection inside a transaction (see wyceny-drizzle.ts), never
-- authenticated directly — and it is not the owner of `wycena`, so RLS
-- applies to it unconditionally.
CREATE ROLE app_role NOLOGIN;
--> statement-breakpoint
GRANT SELECT ON wycena TO app_role;
--> statement-breakpoint
ALTER TABLE wycena ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Defense-in-depth on top of defense-in-depth: FORCE also applies RLS to the
-- table owner. Not strictly required today (app_role is a non-owner, so RLS
-- already applies to it), but it closes the gap if ownership of `wycena`
-- ever changes, and keeps the ADR-013 intent explicit.
ALTER TABLE wycena FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A row is visible when the caller is `admin`, or owns it. Driven per
-- request via `SET LOCAL` + `set_config` (transaction-scoped, pooling-safe)
-- in `wycenyRepo.listForUser` / `wycenyRepo.get`. SELECT-only: `create()`
-- keeps running as the superuser pool connection (no role switch), so
-- writes are unaffected by this policy.
CREATE POLICY wycena_select_isolation ON wycena
  FOR SELECT
  USING (
    current_setting('app.role', true) = 'admin'
    OR owner_id = current_setting('app.user_id', true)
  );

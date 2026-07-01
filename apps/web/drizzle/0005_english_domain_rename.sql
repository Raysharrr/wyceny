-- English-domain rename.
--
-- Renames the wycena entity to valuation throughout the schema, migrates
-- existing status/role data values to their English equivalents, and
-- re-points the F-8 RLS policy (drizzle/0003_wycena_rls.sql) at the
-- renamed table.
--
-- Safe to run against a DB that still has the OLD schema+data (prod's
-- current shape, one create-table migration per 0000-0004): every DDL
-- step is guarded so it no-ops if already applied, and every data UPDATE
-- is scoped by a WHERE clause so re-running it is a no-op once the values
-- are already migrated.

-- 1. Table rename: wycena -> valuation. IF EXISTS makes this a no-op if
--    the table was already renamed by an earlier run of this migration.
ALTER TABLE IF EXISTS wycena RENAME TO valuation;
--> statement-breakpoint
-- 2. Column rename: slownie -> amount_in_words. Postgres has no
--    `RENAME COLUMN IF EXISTS`, so guard it explicitly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'valuation' AND column_name = 'slownie'
  ) THEN
    ALTER TABLE valuation RENAME COLUMN slownie TO amount_in_words;
  END IF;
END $$;
--> statement-breakpoint
-- 2b. Constraint renames for full consistency (pk index + FK), so
--     `\d valuation` never shows a `wycena_*` name. Guarded the same way
--     as the column rename — no-ops once already renamed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wycena_pkey') THEN
    ALTER TABLE valuation RENAME CONSTRAINT wycena_pkey TO valuation_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wycena_owner_id_user_id_fk') THEN
    ALTER TABLE valuation RENAME CONSTRAINT wycena_owner_id_user_id_fk TO valuation_owner_id_user_id_fk;
  END IF;
END $$;
--> statement-breakpoint
-- 3. Status column default: 'w_toku' -> 'in_progress'. Re-setting the
--    same default on a re-run is a harmless no-op.
ALTER TABLE valuation ALTER COLUMN status SET DEFAULT 'in_progress';
--> statement-breakpoint
-- 4. Data migration: existing valuation.status values. WHERE-scoped so a
--    re-run is a safe no-op once every row is already migrated.
UPDATE valuation SET status = 'in_progress' WHERE status = 'w_toku';
--> statement-breakpoint
UPDATE valuation SET status = 'signed' WHERE status = 'podpisany';
--> statement-breakpoint
-- 5. "user".role column default: 'rzeczoznawca' -> 'appraiser'.
ALTER TABLE "user" ALTER COLUMN role SET DEFAULT 'appraiser';
--> statement-breakpoint
-- 6. Data migration: existing "user".role values. WHERE-scoped, same
--    idempotency guarantee as step 4.
UPDATE "user" SET role = 'appraiser' WHERE role = 'rzeczoznawca';
--> statement-breakpoint
-- 7. RLS re-asserted on the renamed table (F-8, ADR-013). A plain table
--    RENAME already carries the GRANT, ENABLE/FORCE ROW LEVEL SECURITY,
--    and the policy itself over (all bound to the relation's OID, not its
--    name) — but every object is re-asserted explicitly here, under its
--    new name, so the intent is visible in migration history and the
--    whole sequence stays safe to re-run. The SET LOCAL app.role
--    mechanism and the admin-or-owner policy logic are unchanged from
--    drizzle/0003_wycena_rls.sql — only the table/policy name changes.
GRANT SELECT ON valuation TO app_role;
--> statement-breakpoint
ALTER TABLE valuation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE valuation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS wycena_select_isolation ON valuation;
--> statement-breakpoint
DROP POLICY IF EXISTS valuation_select_isolation ON valuation;
--> statement-breakpoint
CREATE POLICY valuation_select_isolation ON valuation
  FOR SELECT
  USING (
    current_setting('app.role', true) = 'admin'
    OR owner_id = current_setting('app.user_id', true)
  );

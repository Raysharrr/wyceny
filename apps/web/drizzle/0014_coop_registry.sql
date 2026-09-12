-- Rejestr transakcji spółdzielni mieszkaniowych (T-13, blok "Prawo spółdzielcze", S2a).
-- Hand-written like 0003/0009: the RLS half below is not expressible in the
-- drizzle pg-core DSL and is deliberately NOT mirrored in schema.ts (tables
-- are). Every statement is re-runnable on purpose (IF NOT EXISTS / DO $$):
-- `app_role` is a CLUSTER object, so a second fresh database on a shared
-- cluster dies on 0003's bare CREATE ROLE — this file must not repeat that.
CREATE TABLE IF NOT EXISTS "coop_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"cooperative" text NOT NULL,
	"address" text NOT NULL,
	"building_number" text NOT NULL,
	"flat_number" text NOT NULL,
	"area" numeric NOT NULL,
	"price_total" numeric NOT NULL,
	"date" date NOT NULL,
	"price_kind" text NOT NULL,
	"right_type" text,
	"rep" text,
	"floor" integer,
	"rooms" integer,
	"build_year" integer,
	"pos_x" double precision,
	"pos_y" double precision,
	"source" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"import_batch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "coop_transaction_dedupe" ON "coop_transaction" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coop_import_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"cooperative" text NOT NULL,
	"file_name" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"rows_inserted" integer NOT NULL,
	"rows_skipped" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coop_column_mapping" (
	"cooperative" text PRIMARY KEY NOT NULL,
	"mapping" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- RLS at OFFICE level (decision 2026-09-12): the register is shared by the
-- whole office, and there is no office/organisation entity in the schema —
-- "office" = this instance (spec §4.3, a conscious debt, not an omission).
-- So the policy does NOT filter by owner: any request that has set
-- `app.user_id` (i.e. any logged-in user, see valuation-drizzle.ts
-- `setAppRole`) sees every row; a connection without it sees nothing.
-- `coalesce(..., '') <> ''`, not `IS NOT NULL`: once a pooled session has
-- ever run a transaction-local set_config, the GUC reverts to '' (not NULL)
-- after that transaction — `IS NOT NULL` would then let a bare connection
-- through. Caught by tests/coop-registry-rls.test.ts on the first run.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT ON "coop_transaction" TO app_role;
--> statement-breakpoint
ALTER TABLE "coop_transaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "coop_transaction" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS coop_transaction_office_select ON "coop_transaction";
--> statement-breakpoint
CREATE POLICY coop_transaction_office_select ON "coop_transaction"
  FOR SELECT
  USING (coalesce(current_setting('app.user_id', true), '') <> '');

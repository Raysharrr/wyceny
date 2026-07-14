ALTER TABLE "valuation" ADD COLUMN "approved_at" timestamp with time zone;
--> statement-breakpoint
-- Pre-slice rows were complete saves under the old single-step model —
-- they become 'approved' (spec 2026-07-14 §2); the F-4 gate applies only
-- to drafts created from now on.
UPDATE "valuation" SET "status" = 'approved' WHERE "status" = 'in_progress';
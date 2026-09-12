-- Import batches are opened BEFORE the first chunk of rows and closed by the
-- last one (S2b: chunked import from the UI). finished_at IS NULL = still
-- running, or abandoned (tab closed, timeout) — its rows are real, the batch
-- just never got its final counters. Existing batches were written in one go
-- by S2a, so they are finished by definition. Re-runnable.
ALTER TABLE "coop_import_batch" ADD COLUMN IF NOT EXISTS "finished_at" timestamp with time zone;
UPDATE "coop_import_batch" SET "finished_at" = "created_at" WHERE "finished_at" IS NULL;

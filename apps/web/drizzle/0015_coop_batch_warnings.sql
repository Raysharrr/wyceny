-- Import warnings per batch (review 2 §3): which rows were keyed without a
-- flat number (no_flat) or merged on that basis (no_flat_merge). The only
-- place one can check, a month later, how a batch was keyed. Re-runnable.
ALTER TABLE "coop_import_batch" ADD COLUMN IF NOT EXISTS "rows_warned" jsonb DEFAULT '[]'::jsonb NOT NULL;

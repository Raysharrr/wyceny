CREATE TABLE "appraiser_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"signature_bytes" "bytea" NOT NULL,
	"signature_mime" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"valuation_id" uuid,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
ALTER TABLE "valuation" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "valuation" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "appraiser_profile" ADD CONSTRAINT "appraiser_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation" ADD CONSTRAINT "valuation_supersedes_id_valuation_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."valuation"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- F-7 write-once: superusers bypass RLS but NOT triggers — this is the only
-- DB-level guarantee that binds the app's superuser connection (db/client.ts).
CREATE FUNCTION refuse_signed_valuation_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'valuation % is signed - write-once (F-7)', OLD.id;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER valuation_write_once
  BEFORE UPDATE OR DELETE ON "valuation"
  FOR EACH ROW WHEN (OLD.status = 'signed')
  EXECUTE FUNCTION refuse_signed_valuation_change();
--> statement-breakpoint
CREATE FUNCTION refuse_audit_log_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (F-7)';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION refuse_audit_log_change();
--> statement-breakpoint
-- Conditional freeze: only documents referenced by a SIGNED valuation are
-- immutable. Blanket append-only would break the documented approve/sign
-- retry path (storage.put overwrites same-key orphans, Slice 4 invariant).
-- Couples to the '/api/docs/<key>' URL format — asserted by f7 tests.
CREATE FUNCTION refuse_frozen_document_change() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "valuation" v
    WHERE v.status = 'signed'
      AND (v.doc_url = '/api/docs/' || OLD.key OR v.docx_url = '/api/docs/' || OLD.key)
  ) THEN
    RAISE EXCEPTION 'document % belongs to a signed valuation - frozen (F-7)', OLD.key;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER document_frozen
  BEFORE UPDATE OR DELETE ON "document"
  FOR EACH ROW EXECUTE FUNCTION refuse_frozen_document_change();
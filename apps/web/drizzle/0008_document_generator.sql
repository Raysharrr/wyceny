ALTER TABLE "document" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "content_bytes" "bytea";--> statement-breakpoint
ALTER TABLE "valuation" ADD COLUMN "docx_url" text;--> statement-breakpoint
ALTER TABLE "valuation" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "valuation" ADD COLUMN "kw_number" text;--> statement-breakpoint
ALTER TABLE "valuation" ADD COLUMN "client" text;--> statement-breakpoint
ALTER TABLE "valuation" ADD COLUMN "inspection_date" date;
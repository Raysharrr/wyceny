ALTER TABLE "appraiser_profile" ALTER COLUMN "signature_bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "appraiser_profile" ALTER COLUMN "signature_mime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "appraiser_profile" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "appraiser_profile" ADD COLUMN "license_no" text;--> statement-breakpoint
ALTER TABLE "appraiser_profile" ADD COLUMN "office_block" text;--> statement-breakpoint
ALTER TABLE "appraiser_profile" ADD COLUMN "insurance_doc_key" text;--> statement-breakpoint
ALTER TABLE "appraiser_profile" ADD COLUMN "insurance_valid_until" date;
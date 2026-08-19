CREATE TABLE "event_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"event" text NOT NULL,
	"trace_id" text,
	"valuation_id" uuid,
	"actor_id" text,
	"meta" jsonb
);

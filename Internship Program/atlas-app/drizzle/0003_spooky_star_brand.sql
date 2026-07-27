ALTER TABLE "orgs" ADD COLUMN "ingest_context" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "plan_json" text;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "synthetic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "source_files" ADD COLUMN "plan_reason" text;
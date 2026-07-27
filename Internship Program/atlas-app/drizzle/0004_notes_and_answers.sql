CREATE TABLE "ingest_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"note_key" text NOT NULL,
	"kind" text NOT NULL,
	"topic" text NOT NULL,
	"statement" text NOT NULL,
	"evidence" text NOT NULL,
	"effect" text NOT NULL,
	"answer_kind" text DEFAULT 'none' NOT NULL,
	"options_json" text DEFAULT '[]' NOT NULL,
	"answered_with" text,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_blobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"filename" text NOT NULL,
	"data" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "answers_json" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;
CREATE TABLE "source_files" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"filename" text NOT NULL,
	"role" text NOT NULL,
	"source_format" text NOT NULL,
	"row_count" integer NOT NULL,
	"column_count" integer NOT NULL,
	"join_key" text,
	"matched_rows" integer DEFAULT 0 NOT NULL,
	"unmatched_rows" integer DEFAULT 0 NOT NULL,
	"conflicts" integer DEFAULT 0 NOT NULL,
	"contributed_fields_json" text DEFAULT '[]' NOT NULL,
	"columns_json" text DEFAULT '[]' NOT NULL,
	"conversion_detail" text DEFAULT '' NOT NULL,
	"detail" text NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL
);

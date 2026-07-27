CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"scenario_id" text NOT NULL,
	"position_id" text,
	"action" text NOT NULL,
	"detail" text NOT NULL,
	"who" text NOT NULL,
	"when" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"position_id" text,
	"detail" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"anonymized" boolean DEFAULT true NOT NULL,
	"source_filename" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"raw_name" text,
	"display_name" text NOT NULL,
	"title" text NOT NULL,
	"department" text NOT NULL,
	"manager_id" text,
	"cost" real NOT NULL,
	"fte" real DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'filled' NOT NULL,
	"clinical_flag" boolean DEFAULT false NOT NULL,
	"source_row_index" integer NOT NULL,
	"confidence_json" text DEFAULT '{}' NOT NULL,
	"classification_source" text DEFAULT 'fallback' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"working_graph_json" text NOT NULL,
	"moves_json" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL
);

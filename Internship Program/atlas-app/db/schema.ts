import { pgTable, text, integer, real, boolean } from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  anonymized: boolean("anonymized").notNull().default(true),
  sourceFilename: text("source_filename").notNull(),
  createdAt: text("created_at").notNull(),
});

export const positions = pgTable("positions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  rawName: text("raw_name"),
  displayName: text("display_name").notNull(),
  title: text("title").notNull(),
  department: text("department").notNull(),
  managerId: text("manager_id"),
  cost: real("cost").notNull(),
  fte: real("fte").notNull().default(1),
  status: text("status").notNull().default("filled"),
  clinicalFlag: boolean("clinical_flag").notNull().default(false),
  sourceRowIndex: integer("source_row_index").notNull(),
  confidenceJson: text("confidence_json").notNull().default("{}"),
  classificationSource: text("classification_source").notNull().default("fallback"),
});

export const ingestIssues = pgTable("ingest_issues", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").notNull(),
  positionId: text("position_id"),
  detail: text("detail").notNull(),
  resolved: boolean("resolved").notNull().default(false),
});

export const scenarios = pgTable("scenarios", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  workingGraphJson: text("working_graph_json").notNull(),
  movesJson: text("moves_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

/**
 * What each uploaded file turned out to contain, and what Atlas did with it.
 * Kept per file rather than collapsed into the combined establishment,
 * because the question a client asks on the confirm screen is about *their*
 * file — "where did our cost centre column go?", "did the payroll extract
 * actually land?" — and that can't be answered from the merged result.
 */
export const sourceFiles = pgTable("source_files", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  filename: text("filename").notNull(),
  /** roster | attributes | unusable */
  role: text("role").notNull(),
  sourceFormat: text("source_format").notNull(),
  rowCount: integer("row_count").notNull(),
  columnCount: integer("column_count").notNull(),
  joinKey: text("join_key"),
  matchedRows: integer("matched_rows").notNull().default(0),
  unmatchedRows: integer("unmatched_rows").notNull().default(0),
  conflicts: integer("conflicts").notNull().default(0),
  /** JSON string[] */
  contributedFieldsJson: text("contributed_fields_json").notNull().default("[]"),
  /** JSON {column, field}[] — every column found and what it was read as. */
  columnsJson: text("columns_json").notNull().default("[]"),
  conversionDetail: text("conversion_detail").notNull().default(""),
  detail: text("detail").notNull(),
  needsReview: boolean("needs_review").notNull().default(false),
  /** Upload order, so the report reads back the way the files were added. */
  orderIndex: integer("order_index").notNull().default(0),
});

/**
 * Staging for uploads that arrive in pieces. The host rejects any single
 * request over ~4.5MB at its edge, before application code runs, so a larger
 * upload has to be sent as several small requests and reassembled here. Rows
 * live only for the few seconds between the last chunk arriving and the
 * ingest reading it, and are deleted immediately afterwards.
 */
export const uploadChunks = pgTable("upload_chunks", {
  id: text("id").primaryKey(),
  uploadId: text("upload_id").notNull(),
  filename: text("filename").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  /** Base64 — the file's bytes, not its parsed contents. */
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  positionId: text("position_id"),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  who: text("who").notNull(),
  when: text("when").notNull(),
});

export type OrgRow = typeof orgs.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type ScenarioRow = typeof scenarios.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type IngestIssueRow = typeof ingestIssues.$inferSelect;
export type UploadChunkRow = typeof uploadChunks.$inferSelect;
export type SourceFileRow = typeof sourceFiles.$inferSelect;

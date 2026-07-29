import { pgTable, text, integer, real, boolean } from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  anonymized: boolean("anonymized").notNull().default(true),
  sourceFilename: text("source_filename").notNull(),
  createdAt: text("created_at").notNull(),
  /** The instructions typed on the upload screen, verbatim. */
  ingestContext: text("ingest_context"),
  /** JSON IngestPlan — how those instructions were read, and what was ignored. */
  planJson: text("plan_json"),
  /** JSON IngestAnswers — what the client corrected after seeing the first read. */
  answersJson: text("answers_json"),
  /**
   * JSON BusinessContext — the hypothesis layer. What the client said about
   * the business the establishment belongs to: what it does, what it earns,
   * what they are trying to reach, and what they already suspect is wrong.
   *
   * Kept apart from `ingest_context` because the two are read by different
   * things at different times. Ingest context decides how the files are bound
   * and is spent once. This is never read by the ingest at all — it is applied
   * every time the findings are computed, so changing it re-frames the whole
   * analysis without re-reading a single file.
   */
  businessJson: text("business_json"),
  /**
   * JSON CleaningLedger — what was thrown away between the raw files and the
   * establishment, and why.
   *
   * The only part of the ingest that cannot be recovered by looking at the
   * result: the saved positions are what survived the scrub and say nothing
   * about what didn't. Removing rows from a client's data is the most
   * dangerous thing Atlas does precisely because the outcome looks perfect,
   * so the record of it outlives the run that made it.
   */
  cleaningJson: text("cleaning_json"),
  /**
   * JSON StructureVerification — the finished map checked back against the org
   * chart the client uploaded, line by line.
   *
   * Stored rather than recomputed because the chart's reporting lines only
   * exist in translated form during binding: once the graph is built there is
   * one line per position and nothing left to compare it against. Reproducing
   * this from the saved establishment would mean re-running the whole ingest.
   */
  structureQcJson: text("structure_qc_json"),
  /** How many times this establishment has been re-read with new answers. */
  revision: integer("revision").notNull().default(0),
});

/**
 * What Atlas assumed, and what it refused to assume.
 *
 * Kept apart from `ingest_issues` because the two call for opposite things.
 * An issue is a defect in the data — a duplicate ID, an unresolved manager —
 * and the reader's job is to notice it. A note is a limit of the *reading*,
 * and the reader is the only one who can lift it: the client answers, and the
 * establishment is read again with the answer applied.
 */
export const ingestNotes = pgTable("ingest_notes", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  /** Stable across re-reads, so an answer stays attached to its question. */
  noteKey: text("note_key").notNull(),
  /** assumption | question */
  kind: text("kind").notNull(),
  topic: text("topic").notNull(),
  statement: text("statement").notNull(),
  evidence: text("evidence").notNull(),
  effect: text("effect").notNull(),
  /** hours | mapping | none — what kind of answer would close it. */
  answerKind: text("answer_kind").notNull().default("none"),
  /** JSON NoteOption[] — values needing a decision, with Atlas's proposal. */
  optionsJson: text("options_json").notNull().default("[]"),
  answeredWith: text("answered_with"),
  orderIndex: integer("order_index").notNull().default(0),
});

/**
 * The uploaded bytes, kept so answering a question can re-read the same files
 * rather than asking the client to find and upload them again. Re-reading is
 * the only honest way to apply an answer: a paid-hours figure changes what
 * every row costs, and patching the saved positions instead would leave the
 * per-file report describing a read that no longer matches the map.
 */
export const sourceBlobs = pgTable("source_blobs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  filename: text("filename").notNull(),
  /** Base64 of the original file, exactly as uploaded. */
  data: text("data").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
});

export const positions = pgTable("positions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  rawName: text("raw_name"),
  displayName: text("display_name").notNull(),
  title: text("title").notNull(),
  department: text("department").notNull(),
  /**
   * The bucket this department rolls up into — Finance, Operations, People.
   * Derived at ingest and stored rather than recomputed, because placing the
   * names a keyword cannot claim costs a model call, and a comparison whose
   * groups shifted between two page loads would be indefensible.
   *
   * `department` above is never overwritten. Every scenario play works on
   * that, not on this: merging a payroll team into treasury because both are
   * "Finance" is not a consolidation anyone asked for.
   */
  functionGroup: text("function_group"),
  managerId: text("manager_id"),
  cost: real("cost").notNull(),
  fte: real("fte").notNull().default(1),
  status: text("status").notNull().default("filled"),
  clinicalFlag: boolean("clinical_flag").notNull().default(false),
  sourceRowIndex: integer("source_row_index").notNull(),
  confidenceJson: text("confidence_json").notNull().default("{}"),
  classificationSource: text("classification_source").notNull().default("fallback"),
  /** A heading Atlas added to consolidate the map — not a job. See Position.synthetic. */
  synthetic: boolean("synthetic").notNull().default(false),
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
  /** Why the upload instructions put this file in this role, in the planner's words. */
  planReason: text("plan_reason"),
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
export type IngestNoteRow = typeof ingestNotes.$inferSelect;
export type SourceBlobRow = typeof sourceBlobs.$inferSelect;
